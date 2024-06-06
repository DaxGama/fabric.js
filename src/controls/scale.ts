import type {
  ControlCursorCallback,
  TPointerEvent,
  Transform,
  TransformActionHandler,
} from '../EventTypeDefs';
import type { FabricObject } from '../shapes/Object/FabricObject';
import type { TAxis } from '../typedefs';
import type { Canvas } from '../canvas/Canvas';
import {
  findCornerQuadrant,
  getLocalPoint,
  invertOrigin,
  isLocked,
  isTransformCentered,
  NOT_ALLOWED_CURSOR,
} from './util';
import { wrapWithFireEvent } from './wrapWithFireEvent';
import { wrapWithFixedAnchor } from './wrapWithFixedAnchor';

type ScaleTransform = Transform & {
  gestureScale?: number;
  signX?: number;
  signY?: number;
};

type ScaleBy = TAxis | 'equally' | '' | undefined;

/**
 * Inspect event and fabricObject properties to understand if the scaling action
 * @param {Event} eventData from the user action
 * @param {FabricObject} fabricObject the fabric object about to scale
 * @return {Boolean} true if scale is proportional
 */
export function scaleIsProportional(
  eventData: TPointerEvent,
  fabricObject: FabricObject
): boolean {
  if (fabricObject.lockUniScaling) return true;
  const canvas = fabricObject.canvas as Canvas,
    uniformIsToggled = eventData[canvas.uniScaleKey!];
  return (
    (canvas.uniformScaling && !uniformIsToggled) ||
    (!canvas.uniformScaling && uniformIsToggled)
  );
}

/**
 * Inspect fabricObject to understand if the current scaling action is allowed
 * @param {FabricObject} fabricObject the fabric object about to scale
 * @param {String} by 'x' or 'y' or ''
 * @param {Boolean} scaleProportionally true if we are trying to scale proportionally
 * @return {Boolean} true if scaling is not allowed at current conditions
 */
export function scalingIsForbidden(
  fabricObject: FabricObject,
  by: ScaleBy,
  scaleProportionally: boolean
) {
  const lockX = isLocked(fabricObject, 'lockScalingX'),
    lockY = isLocked(fabricObject, 'lockScalingY');
  if (lockX && lockY) {
    return true;
  }
  if (!by && (lockX || lockY) && scaleProportionally) {
    return true;
  }
  if (lockX && by === 'x') {
    return true;
  }
  if (lockY && by === 'y') {
    return true;
  }
  // code crashes because of a division by 0 if a 0 sized object is scaled
  // forbid to prevent scaling to happen. ISSUE-9475
  const { width, height, strokeWidth } = fabricObject;
  if (width === 0 && strokeWidth === 0 && by !== 'y') {
    return true;
  }
  if (height === 0 && strokeWidth === 0 && by !== 'x') {
    return true;
  }
  return false;
}

const scaleMap = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne', 'e'];

/**
 * return the correct cursor style for the scale action
 * @param {Event} eventData the javascript event that is causing the scale
 * @param {Control} control the control that is interested in the action
 * @param {FabricObject} fabricObject the fabric object that is interested in the action
 * @return {String} a valid css string for the cursor
 */
export const scaleCursorStyleHandler: ControlCursorCallback = (
  eventData,
  control,
  fabricObject
) => {
  const scaleProportionally = scaleIsProportional(eventData, fabricObject),
    by =
      control.x !== 0 && control.y === 0
        ? 'x'
        : control.x === 0 && control.y !== 0
          ? 'y'
          : '';
  if (scalingIsForbidden(fabricObject, by, scaleProportionally)) {
    return NOT_ALLOWED_CURSOR;
  }
  const n = findCornerQuadrant(fabricObject, control);
  return `${scaleMap[n]}-resize`;
};

/**
 * Basic scaling logic, reused with different constrain for scaling X,Y, freely or equally.
 * Needs to be wrapped with `wrapWithFixedAnchor` to be effective
 * @param {Event} eventData javascript event that is doing the transform
 * @param {Object} transform javascript object containing a series of information around the current transform
 * @param {number} x current mouse x position, canvas normalized
 * @param {number} y current mouse y position, canvas normalized
 * @param {Object} options additional information for scaling
 * @param {String} options.by 'x', 'y', 'equally' or '' to indicate type of scaling
 * @return {Boolean} true if some change happened
 * @private
 */
export function scaleObject(
  eventData: TPointerEvent,
  transform: ScaleTransform,
  x: number,
  y: number,
  options: { by?: ScaleBy } = {}
) {
  const target = transform.target,
    by = options.by,
    scaleProportionally = scaleIsProportional(eventData, target),
    forbidScaling = scalingIsForbidden(target, by, scaleProportionally);
  let newPoint, scaleX, scaleY, dim, signX, signY;

  if (forbidScaling) {
    return false;
  }

  if (target.canvas?.snapPointFn && !target.angle) {
    const snapped = target.canvas.snapPointFn([x, y]);
    x = snapped[0];
    y = snapped[1];
  }

  if (transform.gestureScale) {
    scaleX = transform.scaleX * transform.gestureScale;
    scaleY = transform.scaleY * transform.gestureScale;
  } else {
    newPoint = getLocalPoint(
      transform,
      transform.originX,
      transform.originY,
      x,
      y
    );
    // use of sign: We use sign to detect change of direction of an action. sign usually change when
    // we cross the origin point with the mouse. So a scale flip for example. There is an issue when scaling
    // by center and scaling using one middle control ( default: mr, mt, ml, mb), the mouse movement can easily
    // cross many time the origin point and flip the object. so we need a way to filter out the noise.
    // This ternary here should be ok to filter out X scaling when we want Y only and vice versa.
    signX = by !== 'y' ? Math.sign(newPoint.x || transform.signX || 1) : 1;
    signY = by !== 'x' ? Math.sign(newPoint.y || transform.signY || 1) : 1;
    if (!transform.signX) {
      transform.signX = signX;
    }
    if (!transform.signY) {
      transform.signY = signY;
    }

    if (
      isLocked(target, 'lockScalingFlip') &&
      (transform.signX !== signX || transform.signY !== signY)
    ) {
      return false;
    }

    dim = target._getTransformedDimensions();
    // missing detection of flip and logic to switch the origin
    if (scaleProportionally && !by) {
      // uniform scaling
      // const distance = Math.abs(newPoint.x) + Math.abs(newPoint.y),
      //   { original } = transform,
      //   originalDistance =
      //     Math.abs((dim.x * original.scaleX) / target.scaleX) +
      //     Math.abs((dim.y * original.scaleY) / target.scaleY),
      //   scale = distance / originalDistance;
      // scaleX = original.scaleX * scale;
      // scaleY = original.scaleY * scale;
      scaleX = Math.abs(newPoint.x * target.scaleX / dim.x) / transform.original.scaleX;
      scaleY = Math.abs(newPoint.y * target.scaleY / dim.y) / transform.original.scaleY;
      const scale = Math.max(scaleX, scaleY);
      scaleX = transform.original.scaleX * scale;
      scaleY = transform.original.scaleY * scale;
    } else {
      scaleX = Math.abs((newPoint.x * target.scaleX) / dim.x);
      scaleY = Math.abs((newPoint.y * target.scaleY) / dim.y);
    }
    // if we are scaling by center, we need to double the scale
    if (isTransformCentered(transform)) {
      scaleX *= 2;
      scaleY *= 2;
    }
    if (signX && transform.signX !== signX && by !== 'y') {
      transform.originX = invertOrigin(transform.originX);
      transform.originX2 = invertOrigin(transform.originX2);
      scaleX *= -1;
      transform.signX = signX;
    }
    if (signY && transform.signY !== signY && by !== 'x') {
      transform.originY = invertOrigin(transform.originY);
      transform.originY2 = invertOrigin(transform.originY2);
      scaleY *= -1;
      transform.signY = signY;
    }
  }
  // minScale is taken care of in the setter.
  // const oldScaleX = target.scaleX,
  //   oldScaleY = target.scaleY;
  let changeX = false, changeY = false;

  if (!by) {
    if (!isLocked(target, 'lockScalingX')) changeX = true;
    if (!isLocked(target, 'lockScalingY')) changeY = true;
  } else {
    // forbidden cases already handled on top here.
    if (by === 'x') changeX = true;
    if (by === 'y') changeY = true;
  }

  if ((target as any)._objects) {
    if (changeX) target.set({ _scaleX: scaleX });
    if (changeY) target.set({ _scaleY: scaleY });
  } else {
    if (changeX) target.set({ scaleX: Math.sign(scaleX), width: Math.round(Math.abs(target.width * scaleX) || 1) });
    if (changeY) target.set({ scaleY: Math.sign(scaleY), height: Math.round(Math.abs(target.height * scaleY) || 1) });
  }

  // return oldScaleX !== target.scaleX || oldScaleY !== target.scaleY;
  return changeX || changeY;
}

/**
 * Generic scaling logic, to scale from corners either equally or freely.
 * Needs to be wrapped with `wrapWithFixedAnchor` to be effective
 * @param {Event} eventData javascript event that is doing the transform
 * @param {Object} transform javascript object containing a series of information around the current transform
 * @param {number} x current mouse x position, canvas normalized
 * @param {number} y current mouse y position, canvas normalized
 * @return {Boolean} true if some change happened
 */
export const scaleObjectFromCorner: TransformActionHandler<ScaleTransform> = (
  eventData,
  transform,
  x,
  y
) => {
  return scaleObject(eventData, transform, x, y);
};

/**
 * Scaling logic for the X axis.
 * Needs to be wrapped with `wrapWithFixedAnchor` to be effective
 * @param {Event} eventData javascript event that is doing the transform
 * @param {Object} transform javascript object containing a series of information around the current transform
 * @param {number} x current mouse x position, canvas normalized
 * @param {number} y current mouse y position, canvas normalized
 * @return {Boolean} true if some change happened
 */
const scaleObjectX: TransformActionHandler<ScaleTransform> = (
  eventData,
  transform,
  x,
  y
) => {
  return scaleObject(eventData, transform, x, y, { by: 'x' });
};

/**
 * Scaling logic for the Y axis.
 * Needs to be wrapped with `wrapWithFixedAnchor` to be effective
 * @param {Event} eventData javascript event that is doing the transform
 * @param {Object} transform javascript object containing a series of information around the current transform
 * @param {number} x current mouse x position, canvas normalized
 * @param {number} y current mouse y position, canvas normalized
 * @return {Boolean} true if some change happened
 */
const scaleObjectY: TransformActionHandler<ScaleTransform> = (
  eventData,
  transform,
  x,
  y
) => {
  return scaleObject(eventData, transform, x, y, { by: 'y' });
};

export const scalingEqually = wrapWithFireEvent(
  'scaling',
  wrapWithFixedAnchor(scaleObjectFromCorner)
);

export const scalingX = wrapWithFireEvent(
  'scaling',
  wrapWithFixedAnchor(scaleObjectX)
);

export const scalingY = wrapWithFireEvent(
  'scaling',
  wrapWithFixedAnchor(scaleObjectY)
);
