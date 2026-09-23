export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Mesh = { pos: number[][]; idx: number[]; uv: number[][]; nrm?: number[][] };
export type EnginePart = {
  mesh: Mesh; color: string; tex?: string; rough?: number; metal?: number;
  opacity?: number; emissive?: string; bump?: number; surf?: boolean;
};
export type TextureSpec = {
  base: string; belly?: string; pattern?: string; patternColor?: string;
  freq?: number; seed?: number; bumpStrength?: number;
};
export type Group = {
  color: string; tex?: string; rough: number; metal: number; opacity: number; emissive?: string;
  pos: number[][]; idx: number[]; uv: number[][]; nrm: number[][];
};
export type Skin = { diffuse: Buffer; normal: Buffer };
