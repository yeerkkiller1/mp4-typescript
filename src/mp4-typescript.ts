import { createSimulatedFrame } from "./media/jpeg";

import { range, wrapAsync, randomUID } from "./util/misc";
import { SPS, PPS, NALType, NALList, ConvertAnnexBToAVCC, NALRawType, NALListRaw, NALLength } from "./parser-implementations/NAL";
import * as NAL from "./parser-implementations/NAL";
import { LargeBuffer } from "./parser-lib/LargeBuffer";
import { parseObject } from "./parser-lib/BinaryCoder";
import { createVideo3 } from "./media/create-mp4";
import { writeFileSync, readFile } from "fs";
import { CreateTempFolderPath } from "temp-folder";
import { SetTimeoutAsync } from "pchannel";
import { testReadFile } from "./test/utils";

import * as net from "net";

import * as Jimp from "jimp";
let jimpAny = Jimp as any;

//console.log(ParseNalHeaderByte(33));

/** The header byte is the first byte after the start code. */
export function ParseNalHeaderByte(headerByte: number): "sps"|"pps"|"sei"|"slice"|"unknown" {
    return NAL.ParseNalHeaderByte(headerByte);
}

//import * as native from "native";
// Hmm... we don't actually need this. I was going to use it for ConvertAnnexBToAVCC,
//  because it took ~25% of the total time. But... then I updated to the latest version of node, and now it takes less than 10%,
//  and our whole program is only about 10% of x264, so we can leave it in javascript.
// Also, writing to the jpegs is surprisingly slow. Maybe about 27ms per frame, when x264 takes about 70ms per frame to encode,
//  so writing the jpegs is really way too slow.
//var data = Buffer.from([60, 70]);
//data = native.hello(data);
//console.log(data.toString());

/*
wrapAsync(async () => {
    for(let i = 0; i < 100; i++) {
        let frame = await createSimulatedFrame(i, 1920, 1080);
        writeFileSync(`./dist/frame${i}.jpeg`, frame);
    }
});
//*/

/*
var server = net.createServer(socket => {
    var buffers: Buffer[] = [];
    console.log("Got client");
    socket.on("close", () => {
        console.log("closed");

        let data = new LargeBuffer(buffers);
        data = ConvertAnnexBToAVCC(data);

        let nals = parseObject(data, NALList(4, undefined, undefined));
        for(let NAL of nals.NALs) {
            let nal = NAL.nalObject;
            console.log(nal.type);
            if(nal.type === "slice") {
                console.log("pic_order_cnt_lsb", nal.nal.slice_header.pic_order_cnt_lsb, nal.nal.slice_header.sliceTypeStr);
            }
        }
        console.log(`Got ${nals.NALs.length} nals`);
    });
    socket.on("error", () => {
        console.log("error");
    });
    socket.on("data", (data) => {
        buffers.push(data);
    });
});
server.listen(3000, "0.0.0.0");
*/


//testReadFile("")

//todonext
// expose and test highly variable FPS video, via sample_duration to stretch frames.

/*
(async () => {
    let nals = LargeBuffer.FromFile("C:/scratch/frames.nal")
    let avccNals = ConvertAnnexBToAVCC(nals);
    let video = await InternalCreateVideo({
        fixedBuffer: avccNals,
        baseMediaDecodeTimeInSeconds: 0,
        fps: 10
    });

    writeFileSync("C:/scratch/what.mp4", video);
})
()
;
//*/

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
}): Promise<Buffer> {
    let { x264 } = eval(`require("x264-npm")`);

    let { jpegPattern, ...passThroughParams } = params;

    let folderPath = await CreateTempFolderPath();
    let nalOutput = `${folderPath}_${randomUID("nal")}.nal`;
    await profile("x264", async () => {
        console.log(await x264("--output", nalOutput, jpegPattern, "--bframes", "0"));
    });

    let timescale = params.fps;
    let frameTimeInTimescale = 1;
    // Hmm... it doesn't appear as if video players EVEN look at these. So... I'm going to just set them to 0, because
    //  getting the values could be really difficult and slow (we have to figure out the jpegPattern, and then decode the jpeg),
    //  and it doesn't even appear to matter.
    let width = 0;
    let height = 0;
    
    let NALs!: ReturnType<typeof getH264NALs>;
    
    let fixedBuffer: LargeBuffer = LargeBuffer.FromFile(nalOutput);
    
    await profile("ConvertAnnexBToAVCC", async () => {
        fixedBuffer = ConvertAnnexBToAVCC(fixedBuffer);
    });

    return await InternalCreateVideo({
        ...passThroughParams,
        fixedBuffer
    });
}

/** 'mux', but with no audio, so I don't really know what this is. */
export async function MuxVideo(params: {
    /** Not annex B or AVCC. They should have no start codes or start lengths. */
    nals: Buffer[];
    baseMediaDecodeTimeInSeconds: number;
    fps: number;
}): Promise<Buffer> {

    let { nals, ...passThroughParams } = params;

    let fixedBuffer = new LargeBuffer(nals.map(nal => new LargeBuffer([NALLength(4).write({ curBitSize: 0, value: -1, getSizeAfter: () => nal.length }), nal])));

    return await InternalCreateVideo({
        ...passThroughParams,
        fixedBuffer
    });
}

// time gst-launch-1.0 -vv -e v4l2src device=/dev/video0 ! capsfilter caps="image/jpeg,width=1920,height=1080,framerate=30/1" ! jpegdec ! omxh264enc target-bitrate=15000000 control-rate=variable periodicty-idr=10 ! video/x-h264, profile=high ! tcpclientsink port=3000 host=192.168.0.202

// time gst-launch-1.0 -vv -e filesrc location=raw10.jpeg ! filesink=output10.h264

// time gst-launch-1.0 -vv -e multifilesrc location="raw%d.jpeg" ! capsfilter caps="image/jpeg,width=1920,height=1080,framerate=30/1" ! jpegdec ! omxh264enc target-bitrate=15000000 control-rate=variable ! video/x-h264, profile=high ! multifilesink location="output.h264"

// time gst-launch-1.0 -vv -e multifilesrc location="raw%d.jpeg" ! capsfilter caps="image/jpeg,width=1920,height=1080,framerate=30/1" ! omxmjpegdec ! multifilesink location=raw%d.yuv

// time gst-launch-1.0 -vv -e v4l2src device=/dev/video0 num-buffers=10 ! capsfilter caps="image/jpeg,width=1920,height=1080,framerate=30/1" ! multifilesink location="frame%d.jpeg"

async function InternalCreateVideo(params: {
    /** AVCC */
    fixedBuffer: LargeBuffer;
    baseMediaDecodeTimeInSeconds: number;
    fps: number;
}): Promise<Buffer> {

    let folderPath = await CreateTempFolderPath();

    // Hmm... it doesn't appear as if video players EVEN look at these. So... I'm going to just set them to 0, because
    //  getting the values could be really difficult and slow (we have to figure out the jpegPattern, and then decode the jpeg),
    //  and it doesn't even appear to matter.
    let width = 0;
    let height = 0;
    
    let NALs!: ReturnType<typeof getH264NALs>;

    await profile("getH264NAL", async () => {
        NALs = getH264NALs(
            [{
                path: "NO_PATH",
                buf: params.fixedBuffer
            }]
        );

        console.log(`Found NALs ${NALs.length}`);
    });
    
    let outputPath = `${folderPath}_${randomUID("mp4")}.mp4`;
    await profile("createVideo3", async () => {
        let timescale = params.fps;

        let frames = NALs.filter(x => x.nalObject.type === "slice").map(x => {
            return {
                nal: x,
                frameTimeInTimescale: 1
            };
        });
        await createVideo3(outputPath, {
            timescale,
            width,
            height,
            baseMediaDecodeTimeInTimescale: params.baseMediaDecodeTimeInSeconds * timescale,
            addMoov: true,
            frames: frames,
            sps: NALs.filter(x => x.nalObject.type === "sps")[0],
            pps: NALs.filter(x => x.nalObject.type === "pps")[0]
        });
    });

    // Well... if we every want to support > 4GB or 2GB or whatever files, we would need to change this line. Everything else supports
    //  very large files (maybe not x264, I'm not sure), because we use LargeBuffer everywhere else. However, exporting the LargeBuffer
    //  types is a lot, and so I am only exporting Buffer for the purpose of keeping the .d.ts file for this clean.
    return await readFilePromise(outputPath);
}

//*/

//todonext
//  Use temp-folder to create a place we can store the intermediate nal files (and .mp4 files) without slowly filling up the disk
//      as our process is spuriously terminated.
//  Then create the function that takes a string path to jpegs (using %d to access multiple), and returns a Buffer, that is a mp4 file.
//      Consider an option that returns a file path instead, which is expected to be moved or deleted by the caller?


/*
function createMP4(jpegPathPattern: string): LargeBuffer {
    // os.tmpdir
    // process.on('exit')
}
*/

// get-process explorer | % { @{ 'Id'=$_.Id; 'StartTime'=$_.StartTime } }
// get-process explorer | Select-Object -Property Id, StartTime

// get-process explorer | % { @{  } }
// get-process explorer | Select-Object -Property
// ConvertTo-Json

// get-process -Id | % { @{ 'Id'=$_.Id; 'StartTime'=$_.StartTime } }

//todonext
// Create utility to run a script on process end. And the only good way to detect when a process exits, is to have a watchdog process.
//  AND, we need to check process start time, in case a process is killed an another one is created with the same id in between our poll loop.


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


/*
wrapAsync(async () => {
    let sps: SPS|undefined = undefined;
    let pps: PPS|undefined = undefined;
    let timescale = 5;
    let frameTimeInTimescale = 1;
    let width = 800;
    let height = 600;
    for(let i = 0; i < 3; i++) {
        let files = range(i * 10, i * 10 + 10).map(i => `./dist/output${i}.nal`);
        let NALs = getH264NALs(
            files.map(path => ({
                path,
                buf: ConvertAnnexBToAVCC(LargeBuffer.FromFile(path))
            })),
            sps,
            pps
        );
        //console.log(`Got ${NALs.length} NALS`);
        let outputName = `./dist/output${i}.mp4`;
        let obj: {sps: SPS, pps: PPS} = await createVideo3(outputName, {
            timescale,
            frameTimeInTimescale,
            width,
            height,
            baseMediaDecodeTimeInTimescale: i * 10 * frameTimeInTimescale
        }, NALs, sps, pps);
        sps = obj.sps;
        pps = obj.pps;

        //testReadFile(outputName);
    }
});
//*/

/*
for(let type of ["exit", "SIGINT", "SIGUSR1", "SIGUSR2", "uncaughtException", "cleanup"]) {
    process.on(type, () => {
        writeFileSync(`./dist/${type}`, "test");
    });
}


setInterval(() => {}, 1000);
*/