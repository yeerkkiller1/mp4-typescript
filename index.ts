import { ConvertAnnexBToRawBuffers } from "./src/parser-implementations/NAL";
import { LargeBuffer } from "./src/parser-lib/LargeBuffer";
import * as NAL from "./src/parser-implementations/NAL";
import { MuxVideo } from "./src/mp4-typescript";

export async function H264toMP4(config: {
    buffer: Buffer;
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
    let buf = ConvertAnnexBToRawBuffers(new LargeBuffer([buffer]));

    let sps: Buffer[] = [];
    let pps: Buffer[] = [];
    let frames: Buffer[] = [];
    let keyFrameCount = 0;
    for (let b of buf) {
        let parsed = NAL.ParseNalHeaderByte2(b.readUInt8(0));
        let realBuffer = b.getCombinedBuffer();
        if (parsed === "sps") {
            sps.push(realBuffer);
        } else if (parsed === "pps") {
            pps.push(realBuffer);
        } else if (parsed === "frame") {
            frames.push(realBuffer);
        } else if (parsed === "keyframe") {
            keyFrameCount++;
            frames.push(realBuffer);
        }
    }
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