import { createSimulatedFrame } from "./media/jpeg";

import { range, wrapAsync, randomUID } from "./util/misc";
import { SPS, PPS, NALType, NALList, ConvertAnnexBToAVCC, NALRawType, NALListRaw, NALLength, NALCreateRaw } from "./parser-implementations/NAL";
import * as NAL from "./parser-implementations/NAL";
import { LargeBuffer } from "./parser-lib/LargeBuffer";
import { parseObject, filterBox, writeObject } from "./parser-lib/BinaryCoder";
import { createVideo3 } from "./media/create-mp4";
import { writeFileSync, readFile, readFileSync } from "fs";
import { CreateTempFolderPath } from "temp-folder";
import { SetTimeoutAsync } from "pchannel";
import { testReadFile, testWriteFile, testWrite } from "./test/utils";

import * as net from "net";

import * as Jimp from "jimp";
import { RootBox } from "./parser-implementations/BoxObjects";
let jimpAny = Jimp as any;

//testReadFile("C:/scratch/test.mp4");
//testReadFile("./dist/output0.mp4");
//testWriteFile("./dist/output0.mp4");

//testReadFile("./dist/output0.mp4");
//testReadFile("./dist/output0NEW.mp4");

if(process.argv.length >= 2 && process.argv[0].replace(/\\/g, "/").endsWith("/node") && process.argv[1].replace(/\\/g, "/").endsWith("/mp4-typescript")) {
    main(process.argv.slice(2));
}

function main(args: string[]) {
    if(args.length <= 1) {
        console.error(`Format: ["nal", filePath]`);
        process.exit();
    }

    let verb = args[0];
    switch(verb) {
        default: throw new Error(`Unsupported verb ${verb}`);
        case "nal": {
            let path = args[1];

            let buf = ConvertAnnexBToAVCC(LargeBuffer.FromFile(path));
            let nals = parseObject(buf, NALList(4, undefined, undefined)).NALs;

            console.log(`Found ${nals.length} NALs`);
            for(let nal of nals) {
                let type = nal.nalObject.type;
                if(nal.nalObject.type === "slice") {
                    let header = nal.nalObject.nal.slice_header;
                    console.log(`${type} ${header.sliceTypeStr}, order lsb: ${header.pic_order_cnt_lsb}`);
                } else {
                    console.log(`${type}`);
                }
            }

            break;
        }
    }
}


/** The header byte is the first byte after the start code. */
export function ParseNalHeaderByte(headerByte: number): "sps"|"pps"|"sei"|"slice"|"unknown" {
    return NAL.ParseNalHeaderByte(headerByte);
}

async function createSimulateFrame(time: number, text: string, width: number, height: number): Promise<Buffer> {
    async function loadFont(type: string): Promise<any> {
        return new Promise((resolve, reject) => {
            let jimpAny = Jimp as any;    
            jimpAny.loadFont(type, (err: any, font: any) => {
                if(err) {
                    reject(err);
                } else {
                    resolve(font);
                }
            });
        });
    }
    let image: any;
    image = new jimpAny(width, height, 0xFF00FFFF, () => {});
    
    image.resize(width, height);

    let data: Buffer = image.bitmap.data;
    let frameNumber = ~~time;
    for(let i = 0; i < width * height; i++) {
        let k = i * 4;
        let seed = (frameNumber + 1) * i;
        data[k] = seed % 256;
        data[k + 1] = (seed * 67) % 256;
        data[k + 2] = (seed * 679) % 256;
        data[k + 3] = 255;
    }

    let imageColor = new jimpAny(width, 64, 0x000000AF, () => {});
    image.composite(imageColor, 0, 0);

    let path = "./node_modules/jimp/fonts/open-sans/open-sans-64-white/open-sans-64-white.fnt";
    let font = await loadFont(path);
    image.print(font, 0, 0, `frame time ${time.toFixed(2)}ms (${text})`, width);
    
    let jpegBuffer!: Buffer;
    image.quality(75).getBuffer(Jimp.MIME_JPEG, (err: any, buffer: Buffer) => {
        if(err) throw err;
        jpegBuffer = buffer;
    });

    return jpegBuffer;
}


async function profile(name: string, code: () => Promise<void>): Promise<void> {
    let time = +new Date();
    try {
        await code();
    } finally {
        time = +new Date() - time;

        console.log(`${name} took ${time}ms`);
    }
}

function readFilePromise(path: string) {
    return new Promise<Buffer>((resolve, reject) => {
        readFile(path, (err, data) => {
            err ? reject(err) : resolve(data);
        });
    });
}


export async function CreateVideo(params: {
    jpegPattern: string;
    baseMediaDecodeTimeInSeconds: number;
    fps: number;
    // These are important, and if they aren't correct bad things will happen.
    width: number;
    height: number;
}): Promise<Buffer> {
    let { x264 } = eval(`require("x264-npm")`);

    let { jpegPattern, fps, ...passThroughParams } = params;

    let folderPath = await CreateTempFolderPath();
    let nalOutput = `${folderPath}_${randomUID("nal")}.nal`;
    await profile("x264", async () => {
        console.log(await x264("--output", nalOutput, jpegPattern, "--bframes", "0"));
    });
      
    let fixedBuffer: LargeBuffer = LargeBuffer.FromFile(nalOutput);
    
    await profile("ConvertAnnexBToAVCC", async () => {
        fixedBuffer = ConvertAnnexBToAVCC(fixedBuffer);
    });

    let NALs!: NALRawType[];
    await profile("getH264NAL", async () => {
        NALs = getH264NALs(
            [{
                path: "NO_PATH",
                buf: fixedBuffer
            }]
        );

        console.log(`Found NALs ${NALs.length}`);
    });


    return await InternalCreateVideo({
        ...passThroughParams,
        frames: NALs.filter(x => x.nalObject.type === "slice").map(x => {
            return {
                nal: x,
                frameDurationInSeconds: 1 / fps
            };
        }),
        sps: NALs.filter(x => x.nalObject.type === "sps")[0],
        pps: NALs.filter(x => x.nalObject.type === "pps")[0]
    });
}

/** 'mux', but with no audio, so I don't really know what this is. */
export async function MuxVideo(params: {
    /** Not annex B or AVCC. They should have no start codes or start lengths, and each Buffer should be one NAL. */
    sps: Buffer;
    pps: Buffer;
    frames: {
        buf: Buffer;
        frameDurationInSeconds: number;
    }[];
    baseMediaDecodeTimeInSeconds: number;
    // These are important, and if they aren't correct bad things will happen.
    width: number;
    height: number;
}): Promise<Buffer> {

    let { sps, pps, frames, ...passThroughParams } = params;

    function p(buf: Buffer) {
        let prefixedBuffer = new LargeBuffer([NALLength(4).write({ curBitSize: 0, value: -1, getSizeAfter: () => buf.length }), buf]);
        return parseObject(prefixedBuffer, NALCreateRaw(4));
    }
    let spsNal = p(sps);
    let ppsNal = p(pps);
    
    return await InternalCreateVideo({
        ...passThroughParams,
        frames: frames.map(x => {
            return {
                nal: p(x.buf),
                frameDurationInSeconds: x.frameDurationInSeconds
            };
        }),
        sps: spsNal,
        pps: ppsNal,
    });
}

// time gst-launch-1.0 -vv -e v4l2src device=/dev/video0 ! capsfilter caps="image/jpeg,width=1920,height=1080,framerate=30/1" ! jpegdec ! omxh264enc target-bitrate=15000000 control-rate=variable periodicty-idr=10 ! video/x-h264, profile=high ! tcpclientsink port=3000 host=192.168.0.202

// time gst-launch-1.0 -vv -e filesrc location=raw10.jpeg ! filesink=output10.h264

// time gst-launch-1.0 -vv -e multifilesrc location="raw%d.jpeg" ! capsfilter caps="image/jpeg,width=1920,height=1080,framerate=30/1" ! jpegdec ! omxh264enc target-bitrate=15000000 control-rate=variable ! video/x-h264, profile=high ! multifilesink location="output.h264"

// time gst-launch-1.0 -vv -e multifilesrc location="raw%d.jpeg" ! capsfilter caps="image/jpeg,width=1920,height=1080,framerate=30/1" ! omxmjpegdec ! multifilesink location=raw%d.yuv

// time gst-launch-1.0 -vv -e v4l2src device=/dev/video0 num-buffers=10 ! capsfilter caps="image/jpeg,width=1920,height=1080,framerate=30/1" ! multifilesink location="frame%d.jpeg"

async function InternalCreateVideo(params: {
    baseMediaDecodeTimeInSeconds: number;
    width: number;
    height: number;
    frames: {
        nal: NALRawType;
        frameDurationInSeconds: number;
    }[];
    sps: NALRawType;
    pps: NALRawType;
}): Promise<Buffer> {

    let folderPath = await CreateTempFolderPath();

    // These are important, and if they aren't correct bad things will happen.
    let {baseMediaDecodeTimeInSeconds,  width, height, frames, sps, pps } = params;
    
    let outputPath = `${folderPath}_${randomUID("mp4")}.mp4`;
    await profile("createVideo3", async () => {
        // Each frame has different duration, which could be completely unrelated to any fps, so just make a high and nice number.
        let timescale = 5 * 6 * 30 * 100;

        await createVideo3(outputPath, {
            timescale,
            width,
            height,
            baseMediaDecodeTimeInTimescale: Math.round(baseMediaDecodeTimeInSeconds * timescale),
            addMoov: true,
            frames: frames.map(x => {
                return {
                    nal: x.nal,
                    frameDurationInTimescale: Math.round(x.frameDurationInSeconds * timescale)
                }
            }),
            sps: sps,
            pps: pps
        });
    });

    // Well... if we every want to support > 4GB or 2GB or whatever files, we would need to change this line. Everything else supports
    //  very large files (maybe not x264, I'm not sure), because we use LargeBuffer everywhere else. However, exporting the LargeBuffer
    //  types is a lot, and so I am only exporting Buffer for the purpose of keeping the .d.ts file for this clean.
    return await readFilePromise(outputPath);
}

// get-process explorer | % { @{ 'Id'=$_.Id; 'StartTime'=$_.StartTime } }
// get-process explorer | Select-Object -Property Id, StartTime

// get-process explorer | % { @{  } }
// get-process explorer | Select-Object -Property
// ConvertTo-Json

// get-process -Id | % { @{ 'Id'=$_.Id; 'StartTime'=$_.StartTime } }

//todonext
// Create utility to run a script on process end. And the only good way to detect when a process exits, is to have a watchdog process.
//  AND, we need to check process start time, in case a process is killed an another one is created with the same id in between our poll loop.

/** buf in AVCC format */
function getH264NALs(bufs: { buf: LargeBuffer, path: string }[], sps: SPS|undefined = undefined, pps: PPS|undefined = undefined): NALRawType[] {
    let nals: NALRawType[] = [];

    for(let frameObj of bufs) {
        let frame = frameObj.buf;
        let path = frameObj.path;
        let obj = parseObject(frame, NALListRaw(4));

        // Must be a forEach loop, to disconnect the sps variable from these assignments. Otherwise typescript
        //  thinks the assignment (which insures sps is not undefined), maybe impact the output of parseObject,
        //  and so says it cannot determine the type.
        obj.NALs.forEach((nal) => {
            nals.push(nal);
        });
    }
    return nals;
}
