// import { ConvertAnnexBToRawBuffers } from "./src/parser-implementations/NAL";
// import { LargeBuffer } from "./src/parser-lib/LargeBuffer";
// import * as NAL from "./src/parser-implementations/NAL";
// import { MuxVideo } from "./src/mp4-typescript";
const { ConvertAnnexBToRawBuffers } = require("./src/parser-implementations/NAL");
const { LargeBuffer } = require("./src/parser-lib/LargeBuffer");
const NAL = require("./src/parser-implementations/NAL");
const { MuxVideo } = require("./src/mp4-typescript");

export async function H264toMP4(config: {
    buffer: Buffer | Buffer[];
    width?: number;
    height?: number;
    frameDurationInSeconds: number;
    // If you're streaming video you need to set this so it smoothly transitions between videos.
    mediaStartTimeSeconds?: number;
}): Promise<{
    buffer: Buffer;
    frameCount: number;
    keyFrameCount: number;
}> {
    let { buffer, width, height, frameDurationInSeconds } = config;

    let nals = Array.isArray(buffer) ? buffer : SplitAnnexBVideo(buffer);

    let sps = nals.filter(x => IdentifyNal(x) === "sps");
    let pps = nals.filter(x => IdentifyNal(x) === "pps");
    let frames = nals.filter(x => IdentifyNal(x) === "frame" || IdentifyNal(x) === "keyframe");
    let keyFrameCount = nals.filter(x => IdentifyNal(x) === "keyframe").length;

    if (sps.length === 0) {
        throw new Error(`No sps found. Found ${frames.length} frames, and ${keyFrameCount} keyframes`);
    }
    if (pps.length === 0) {
        throw new Error(`No pps found. Found ${frames.length} frames, and ${keyFrameCount} keyframes`);
    }

    // let sps = buf.filter(x => NAL.ParseNalHeaderByte(x.readUInt8(0)) === "sps")[0].getCombinedBuffer();
    // let pps = buf.filter(x => NAL.ParseNalHeaderByte(x.readUInt8(0)) === "pps")[0].getCombinedBuffer();
    // let frames = buf.filter(x => NAL.ParseNalHeaderByte(x.readUInt8(0)) === "slice");

    let output = await MuxVideo({
        sps: sps[0],
        pps: pps[0],
        frames: frames.map((frame, i) => ({
            nal: frame,
            frameDurationInSeconds
        })),
        baseMediaDecodeTimeInSeconds: config.mediaStartTimeSeconds || 0,
        width,
        height,
    });
    return {
        buffer: output,
        frameCount: frames.length,
        keyFrameCount,
    };
}

export function SplitAnnexBVideo(buffer: Buffer): Buffer[] {
    return ConvertAnnexBToRawBuffers(new LargeBuffer([buffer])).map((x: any) => x.getCombinedBuffer());
}

export function IdentifyNal(nal: Buffer) {
    return NAL.ParseNalHeaderByte2(nal.readUInt8(0));
}