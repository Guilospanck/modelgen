export type View = [number, number];
// yaw 0 looks at the model's front (+z faces the camera); pitch looks down.
export const VIEW_PRESETS: Record<string, View[]> = {
  default: [[205, 15], [270, 5], [155, 30]],
  turntable: [0, 45, 90, 135, 180, 225, 270, 315].map(y => [y, 15] as View),
  front: [[0, 5]], side: [[270, 5]], back: [[180, 5]], top: [[0, 80]],
};
