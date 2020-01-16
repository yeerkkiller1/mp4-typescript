import { createSimulatedFrame } from "./media/jpeg";

import { range, wrapAsync, randomUID, keyBy, mapObjectValues } from "./util/misc";
import { SPS, PPS, NALType, NALList, ConvertAnnexBToAVCC, NALRawType, NALListRaw, NALLength, NALCreateRaw, ConvertAnnexBToRawBuffers, NAL_SPS, NAL_SEI, NALCreateRawNoSizeHeader, NALCreateNoSizeHeader } from "./parser-implementations/NAL";
import * as NAL from "./parser-implementations/NAL";
import { LargeBuffer } from "./parser-lib/LargeBuffer";
import { parseObject, filterBox, writeObject } from "./parser-lib/BinaryCoder";
import { createVideo3, SampleInfo } from "./media/create-mp4";
import { writeFileSync, readFile, readFileSync } from "fs";
import { SetTimeoutAsync } from "pchannel";
import { testReadFile, testWriteFile, testWrite } from "./test/utils";

import * as Jimp from "jimp";
import { RootBox, StcoBox } from "./parser-implementations/BoxObjects";
import { ArrayInfinite, TemplateToObject } from "./parser-lib/SerialTypes";
import { RemainingDataRaw } from "./parser-lib/Primitives";
import { min } from "./util/math";
let jimpAny = Jimp as any;

//testReadFile("C:/scratch/test.mp4");
//testReadFile("./dist/output0.mp4");
//testWriteFile("./dist/output0.mp4");

//testReadFile("./dist/output0.mp4");
//testReadFile("./dist/output0NEW.mp4");


if(window === undefined) {
    console.log(process.argv);
    if(process.argv.length > 2 &&
        (process.argv[0].replace(/\\/g, "/").endsWith("/node") || process.argv[0].replace(/\\/g, "/").endsWith("/node.exe")) &&
        process.argv[1].replace(/\\/g, "/").endsWith("/mp4-typescript")
    ) {
        main(process.argv.slice(2));
    }
}


async function main(args: string[]) {
    if(args.length <= 1) {
        console.error(`Format: ["nal", filePath] | ["mux", inputNalPath, outputPath] | ["decodeMP4", inputMP4Path, outputMP4InfoPath|undefined]`);
        process.exit();
    }

    let verb = args[0];
    switch(verb) {
        default: throw new Error(`Unsupported verb ${verb}`);
        case "mux": {
            let inputNalPath = args[1];
            let outputPath = args[2];

            let buf = ConvertAnnexBToRawBuffers(LargeBuffer.FromFile(inputNalPath));

            let sps = buf.filter(x => ParseNalHeaderByte(x.readUInt8(0)) === "sps")[0].getCombinedBuffer();
            let pps = buf.filter(x => ParseNalHeaderByte(x.readUInt8(0)) === "pps")[0].getCombinedBuffer();
            let frames = buf.filter(x => ParseNalHeaderByte(x.readUInt8(0)) === "slice");

            let output = await MuxVideo({
                sps,
                pps,
                frames: frames.map((frame, i) => ({
                    nal: frame.getCombinedBuffer(),
                    frameDurationInSeconds: 1
                })),
                baseMediaDecodeTimeInSeconds: 0,
                width: 640,
                height: 480,
                forcedContainerInfo: {
                    level_idc: 0,
                    profile_idc: 0
                }
            });

            writeFileSync(outputPath, output);

            break;
        }
        case "nal": {
            let path = args[1];

            let buf = ConvertAnnexBToAVCC(LargeBuffer.FromFile(path));

            let nals = parseObject(buf, NALList(4, undefined, undefined)).NALs;
            let rawNals = parseObject(buf, NALListRaw(4)).NALs;

            console.log(`Found ${nals.length} NALs`);
            for(let i = 0; i < nals.length; i++) {
                let nalBuffer = writeObject(NALCreateRaw(4), rawNals[i])

                let nal = nals[i];
                let type = nal.nalObject.type;

                if(nal.nalObject.type === "slice") {
                    let header = nal.nalObject.nal.slice_header;
                    console.log(`${type} (size ${nalBuffer.getLength() - 4}) ${header.sliceTypeStr}, order lsb: ${header.pic_order_cnt_lsb}`);
                } else {
                    console.log(`${type} (size ${nalBuffer.getLength() - 4})`);
                }

                //let nalBuffer = writeObject(NALCreateRaw(4), rawNals[i]);
                //console.log(ParseNalInfo(nalBuffer.DEBUG_getBuffer().slice(4)));
            }

            break;
        }
        case "decodeMP4": {
            let inputMP4Path = args[1];
            let outputMP4InfoPath = args[2] || inputMP4Path + ".json";

            testReadFile(inputMP4Path, outputMP4InfoPath);

            break;
        }
        case "compare": {
            testWrite(LargeBuffer.FromFile(args[1]), LargeBuffer.FromFile(args[2]));
            break;
        }
        case "extractNALs": {
            let inputMP4Path = args[1];
            let outputNALFile = args[2];

            let object = parseObject(LargeBuffer.FromFile(inputMP4Path), RootBox);

            //let samples = filterBox(object)("moof")("traf")("trun")().sample_values;

            let avcC = filterBox(object)("moov")("trak")("mdia")("minf")("stbl")("stsd")("avc1")("avcC")();

            let sps = avcC.spses[0].bytes;
            let pps = avcC.ppses[0].bytes;
            
            let data = filterBox(object)("mdat")();
            let nalList = {
                list: ArrayInfinite({
                    len: NALLength(4),
                    bytes: RemainingDataRaw
                })
            };
            let nals = parseObject(data.bytes, nalList).list.map(x => x.bytes);

            // Now, convert combine nals, sps and pps in annex b format.

            let startCode = new Buffer([0, 0, 0, 1]);

            let output = new LargeBuffer([sps, pps].concat(nals).map(x => new LargeBuffer([startCode, x])));
            output.WriteToFile(outputNALFile);
        }
    }
}

export function DecodeMP4(buffer: Buffer) {
    let result = parseObject(new LargeBuffer([buffer]), RootBox);
    return result as any;
}


/*
let nals = GetMP4NALs("C:/Users/quent/Downloads/Norsk SlowTV Hurtigruten Minutt for Minutt BowCam Part 01 of 35 Bergen til Florø_all_key_frames.mp4");
for(let nal of nals) {
    console.log(nal.time, nal.isKeyFrame);
}
//*/

// 142780546288 bits, should have read 142983720544
// 142983720544

export function GetMP4NALs(path: string): {
    // In milliseconds
    time: number;
    // Raw nal, no start codes or anything
    nal: Buffer;
    isKeyFrame: boolean;
    sps: Buffer;
    pps: Buffer;
    width: number;
    height: number;
}[] {
    // ctts, sample times
    // co64
    // moov.mvhd timescale

    let fileBuffer = LargeBuffer.FromFile(path);
    let object = parseObject(fileBuffer, RootBox);

    let moov = filterBox(object)("moov")();

    let nalsWithTimes: { nal: Buffer; time: number; isKeyFrame: boolean; sps: Buffer; pps: Buffer; width: number; height: number; }[] = [];

    moov.boxes.forEach(box => {
        if(box.type !== "trak") return;
        let type = filterBox(box)("mdia")("minf")("stbl")("stsd")().boxes[0].type;
        if(type !== "avc1") return;

        let { timescale } = filterBox(box)("mdia")("mdhd")();

        let avcC = filterBox(box)("mdia")("minf")("stbl")("stsd")("avc1")("avcC")();
        if(avcC.spses.length !== 1) {
            throw new Error(`Unexpected sps count. Expected 1. ${avcC.spses.length}`);
        }
        if(avcC.ppses.length !== 1) {
            throw new Error(`Unexpected pps count. Expected 1. ${avcC.ppses.length}`);
        }

        let sps = avcC.spses[0].bytes.getCombinedBuffer();
        let pps = avcC.ppses[0].bytes.getCombinedBuffer();

        let stbl = filterBox(box)("mdia")("minf")("stbl");

        let sampleTimeOffsets: number[] | undefined;

        if(stbl().boxes.some(x => x.type === "ctts")) {
            let ctts = stbl("ctts")();
            sampleTimeOffsets = [];
            for(let sampleTimeObj of ctts.samples) {
                for(let i = 0; i < sampleTimeObj.sample_count; i++) {
                    sampleTimeOffsets.push(sampleTimeObj.sample_offset);
                }
            }
        }

        let sampleOffsets: Omit<TemplateToObject<typeof StcoBox>, "header"|"type">;
        if(stbl().boxes.some(x => x.type === "stco")) {
            sampleOffsets = stbl("stco")();
        } else if(stbl().boxes.some(x => x.type === "co64")) {
            sampleOffsets = stbl("co64")();
        } else {
            throw new Error(`Can't find sample byte offsets.`);
        }

        let syncSamples: { [sampleIndex: number]: boolean } | undefined;
        if(stbl().boxes.some(x => x.type === "stss")) {
            syncSamples = mapObjectValues(keyBy(stbl("stss")().sample_indexes, x => (x - 1).toString()), x => true);
        }

        let samplesList = stbl("stts")().samples;
        if(samplesList.length !== 1) {
            throw new Error(`Change in frame rates are unsupported right now. ${samplesList.length} different frame rates`);
        }
        let defaultSampleLength = samplesList[0].sample_delta;

        let sampleSizes = stbl("stsz")();

        let sampleIndex = 0;
        let chunkSampleCounts = stbl("stsc")().entries;
        // The last entry doesn't mean anything, the differences in first_chunk are what matters (which makes you wonder whey there isn't a chunk count instead of index...)

        let width = filterBox(box)("tkhd")().width;
        let height = filterBox(box)("tkhd")().height;

        for(let i = 0; i < chunkSampleCounts.length; i++) {
        //for(let i = 0; i < 1; i++) {
            let samplesPerChunk = chunkSampleCounts[i].samples_per_chunk;

            let curChunkIndex = chunkSampleCounts[i].first_chunk - 1;
            let nextChunkIndex: number;
            if(i + 1 < chunkSampleCounts.length) {
                nextChunkIndex = chunkSampleCounts[i + 1].first_chunk - 1;
            } else {
                nextChunkIndex = sampleOffsets.chunk_offsets.length;
            }
            for(let chunkIndex = curChunkIndex; chunkIndex < nextChunkIndex; chunkIndex++) {
                let fileOffset = sampleOffsets.chunk_offsets[chunkIndex];
                for(let i = 0; i < samplesPerChunk; i++) {
                    let sampleSize = sampleSizes.sample_sizes[sampleIndex];

                    let nalBuffer = fileBuffer.slice(fileOffset, fileOffset + sampleSize);
                    let time = (sampleTimeOffsets && sampleTimeOffsets[sampleIndex] || 0) + sampleIndex * defaultSampleLength;

                    let nalList = {
                        list: ArrayInfinite({
                            len: NALLength(4),
                            bytes: RemainingDataRaw
                        })
                    };
                    let nals = parseObject(nalBuffer, nalList).list.map(x => x.bytes);
                    
                    for(let nal of nals) {
                        let type = ParseNalHeaderByte(nal.readUInt8(0));
                        if(type === "sei") {
                            //console.log(`sei skipped`);
                            continue;
                        }
                        if(type !== "slice") {
                            throw new Error(`Unexpected nal of type ${type}. Expected sei or slice.`);
                        }
                        let isKeyFrame: boolean;
                        if(syncSamples) {
                            isKeyFrame = sampleIndex in syncSamples;
                        } else {
                            let info = ParseNalInfo(nal.getCombinedBuffer());
                            if(info.type === "sei") {
                                // Okay, it's an SEI, then probably a slice. I'm assuming the slice is a key frame, as the SEI is likely
                                //  only on the first frame (which has to be a key frame, right?)
                                isKeyFrame = true;
                            }
                            // 4848
                            else if(info.type !== "slice") {
                                throw new Error(`NAL isn't frame. It is type ${info.type}, should be slice.`);
                            } else {
                                isKeyFrame = info.sliceType === "I";
                            }
                        }

                        nalsWithTimes.push({
                            width,
                            height,
                            nal: nal.getCombinedBuffer(),
                            sps,
                            pps,
                            time: time / timescale * 1000,
                            isKeyFrame
                        });
                    }
 
                    fileOffset += sampleSize;
                    sampleIndex++;
                }
            }
        }
        if(sampleTimeOffsets && sampleIndex !== sampleTimeOffsets.length) {
            throw new Error(`There are ${sampleTimeOffsets.length} sample times, but we read ${sampleIndex} times.`);
        }
    });

    nalsWithTimes.sort((a, b) => a.time - b.time);

    let minTime = min(nalsWithTimes.map(x => x.time));
    nalsWithTimes.forEach(obj => {
        obj.time -= minTime;
    });

    return nalsWithTimes;
}

/** rawNal is a NAL with no start code, or length prefix. */
export function ParseNalInfo(rawNal: Buffer): {
    type: "sps"|"pps"|"sei"|"unknown"
} | {
    type: "slice",
    sliceType: "P"|"B"|"I"|"SP"|"SI"
} {
    return NAL.ParseNalInfo(rawNal);
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
    let frameNumber = Math.floor(time);
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


async function profile(name: string|null, code: () => Promise<void>): Promise<void> {
    let time = +new Date();
    try {
        await code();
    } finally {
        time = +new Date() - time;

        if(name) {
            console.log(`${name} took ${time}ms`);
        }
    }
}

function readFilePromise(path: string) {
    return new Promise<Buffer>((resolve, reject) => {
        readFile(path, (err, data) => {
            err ? reject(err) : resolve(data);
        });
    });
}


/*
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
*/

/** 'mux', but with no audio, so I don't really know what this is. */
export async function MuxVideo(params: {
    /** Not annex B or AVCC. They should have no start codes or start lengths, and each Buffer should be one NAL. */
    sps: Buffer;
    pps: Buffer;
    frames: {
        nal: Buffer;
        frameDurationInSeconds: number;
    }[];
    baseMediaDecodeTimeInSeconds: number;
    // These are important, and if they aren't correct bad things will happen.
    width: number;
    height: number;
    // This is usually read from the NALs, but if this object is passed we don't parse the NALs and
    //  will use this information instead.
    forcedContainerInfo?: {
        profile_idc: number;
        level_idc: number;
    };
    timescale?: number;
}): Promise<Buffer> {
    return await InternalCreateVideo(params);
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
        nal: Buffer;
        frameDurationInSeconds: number;
    }[];
    sps: Buffer;
    pps: Buffer;
    forcedContainerInfo?: {
        profile_idc: number;
        level_idc: number;
    };
    timescale?: number;
}): Promise<Buffer> {

    // These are important, and if they aren't correct bad things will happen.
    let {baseMediaDecodeTimeInSeconds,  width, height, frames, sps, pps } = params;
    
    let output!: Buffer;
    await profile(null, async () => {
        // Each frame has different duration, which could be completely unrelated to any fps, so just make a high and nice number.
        //  OH! New information. The chrome video player cannot handle times in seconds that don't fit in an int (that is, a 32 bit signed integer).
        //      So basically, video.currentTime is time in seconds, and must be able to fit in an int. Our internal times can be larger,
        //      but after dividing by our timescale the times in seconds must always be under 31 bits.
        //      Aka, the year 2038 problem. So stupid...
        let timescale = params.timescale || 5 * 6 * 30 * 100;

        let buf = await createVideo3({
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
            pps: pps,
            forcedContainerInfo: params.forcedContainerInfo,
        });

        // Well... if we every want to support > 4GB or 2GB or whatever files, we would need to change this line. Everything else supports
        //  very large files (maybe not x264, I'm not sure), because we use LargeBuffer everywhere else. However, exporting the LargeBuffer
        //  types is a lot, and so I am only exporting Buffer for the purpose of keeping the .d.ts file for this clean.
        output = buf.getCombinedBuffer();
    });

    return output;
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
