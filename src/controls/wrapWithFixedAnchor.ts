import type { Transform, TransformActionHandler } from '../EventTypeDefs';
import { Canvas } from '../canvas/Canvas';

/**
 * Wrap an action handler with saving/restoring object position on the transform.
 * this is the code that permits to objects to keep their position while transforming.
 * @param {Function} actionHandler the function to wrap
 * @return {Function} a function with an action handler signature
 */
export function wrapWithFixedAnchor<T extends Transform>(
  actionHandler: TransformActionHandler<T>
) {
  return ((eventData, transform, x, y) => {
    const { target } = transform, canvas = target.canvas as Canvas,
      isCentered = canvas.centeredKey && eventData[canvas.centeredKey];

    transform.originX = isCentered ? "center" : transform.originX2;
    transform.originY = isCentered ? "center" : transform.originY2;

    const actionPerformed = actionHandler(eventData, transform, x, y);

    target.setPositionByOrigin(isCentered ? transform.constraintCenter : transform.constraintCorner, transform.originX, transform.originY);

    return actionPerformed;

    // const { target, originX, originY } = transform,
    //   centerPoint = target.getRelativeCenterPoint(),
    //   constraint = target.translateToOriginPoint(centerPoint, originX, originY),
    //   actionPerformed = actionHandler(eventData, transform, x, y);
    // // flipping requires to change the transform origin, so we read from the mutated transform
    // // instead of leveraging the one destructured before
    // target.setPositionByOrigin(
    //   constraint,
    //   transform.originX,
    //   transform.originY
    // );
    // return actionPerformed;
  }) as TransformActionHandler<T>;
}