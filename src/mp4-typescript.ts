import { createSimulatedFrame } from "./media/jpeg";

import { x264 } from "x264-npm";

import { range, wrapAsync, randomUID } from "./util/misc";
import { SPS, PPS, NALType, NALList, ConvertAnnexBToAVCC, NALRawType, NALListRaw } from "./parser-implementations/NAL";
import { LargeBuffer } from "./parser-lib/LargeBuffer";
import { parseObject } from "./parser-lib/BinaryCoder";
import { createVideo3 } from "./media/create-mp4";
import { writeFileSync } from "fs";
import { CreateTempFolderPath } from "temp-folder";
import { SetTimeoutAsync } from "pchannel";
import { testReadFile } from "./test/utils";

import * as native from "native";

// Hmm... we don't actually need this. I was going to use it for ConvertAnnexBToAVCC,
//  because it took ~25% of the total time. But... then I updated to the latest version of node, and now it takes less than 10%,
//  and our whole program is only about 20% of x264, so we can leave it in javascript.
var data = new Buffer([60, 70]);
data = native.hello(data);
console.log(data.toString());

/*
wrapAsync(async () => {
    let time = +new Date();
    for(let i = 0; i < 30; i++) {
        let frame = await createSimulatedFrame(time, 800, 600);
        writeFileSync(`./dist/frame${i}.jpg`, frame);
        time += 100;
    }
});
//*/

// Okay... we are basically there. BUT. Everything is way too slow...

/*
wrapAsync(async () => {
    
    //todonext
    // Write onto the jpegs, with something fast (maybe a v8 plugin), so we will always be able to debug
    //  frames, seeing their original time and stuff.
    // We will make every chunk have consistent FPS, but it looks like different chunks can have different FPS, with no difficulty.
    //  Which is really useful, because we want the FPS to stay the same for a minimum period of time anyway, or else
    //  the video will look too choppy.
    // Then... expose this as a npm package, start faking video streaming to/in camera/streaming, and start saving, transcoding,
    //  and displaying the video in the browser.
    await createVideo({
        jpegPattern: "./dist/frame3%d.jpeg",
        baseMediaDecodeTimeInSeconds: 100 + 2,
        fps: 10,
        outputPath: `./dist/output1.mp4`
    });
});
//*/

async function profile(name: string, code: () => Promise<void>): Promise<void> {
    let time = +new Date();
    try {
        await code();
    } finally {
        time = +new Date() - time;

        console.log(`${name} took ${time}ms`);
    }
}

async function createVideo(params: {
    jpegPattern: string;
    baseMediaDecodeTimeInSeconds: number;
    fps: number;
    outputPath: string;
}) {

    let folderPath = await CreateTempFolderPath();
    let nalOutput = `${folderPath}_${randomUID("nal")}.nal`;
    await profile("x264", async () => {
        console.log(await x264("--output", nalOutput, params.jpegPattern, "--bframes", "0"));
    });

    let timescale = params.fps;
    let frameTimeInTimescale = 1;
    let width = 800;
    let height = 600;
    
    let NALs!: ReturnType<typeof getH264NALs>;
    
    let fixedBuffer: LargeBuffer = LargeBuffer.FromFile(nalOutput);
    
    await profile("ConvertAnnexBToAVCC", async () => {
        fixedBuffer = ConvertAnnexBToAVCC(fixedBuffer);
    });

    await profile("getH264NAL", async () => {
        NALs = getH264NALs(
            [{
                path: nalOutput,
                buf: fixedBuffer
            }]
        );
    });
    
    await profile("createVideo3", async () => {
        let outputName = params.outputPath;
        await createVideo3(outputName, {
            timescale,
            frameTimeInTimescale,
            width,
            height,
            baseMediaDecodeTimeInTimescale: params.baseMediaDecodeTimeInSeconds * timescale,
            addMoov: true
        }, NALs);
    });
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