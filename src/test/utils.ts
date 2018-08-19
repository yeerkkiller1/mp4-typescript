import { LargeBuffer } from "../parser-lib/LargeBuffer";
import { parseObject, writeObject, getBufferWriteContext } from "../parser-lib/BinaryCoder";
import { RootBox } from "../parser-implementations/BoxObjects";
import { basename } from "path";
import { writeFileSync } from "fs";
import { range } from "../util/misc";
import { byteToBits } from "../parser-lib/Primitives";
import { debugString } from "../util/UTF8";

export function testReadFile(path: string, outputPath?: string) {
    let buf = LargeBuffer.FromFile(path);
    testRead(path, buf, outputPath);
}
function prettyPrint(obj: any): string {
    let uniqueId = 0;
    let largeBufferId: { [id: number]: LargeBuffer } = {};
    function cleanOutput(key: string, value: any) {
        //if(key === "size") return undefined;
        //if(key === "headerSize") return undefined;
        if(value && value instanceof LargeBuffer) {
            let id = uniqueId++;
            largeBufferId[id] = value;
            //return `unique${id}`;
            return `Buffer(${value.getLength()})`;
        }
        return value;
    }
    let output = JSON.stringify(obj, cleanOutput, "    ");
    /*
    for(let id in largeBufferId) {
        let text = `"unique${id}"`;
        let buffer = largeBufferId[id];
        let nums: number[] = [];
        for(let b of buffer.getInternalBufferList()) {
            for(let i = 0; i < b.length; i++) {
                nums.push(b[i]);
            }
        }
        output = output.replace(text, `new LargeBuffer([Buffer.from([${nums.join(",")}])])`);
    }
    */
    return output;
}
function testRead(path: string, buf: LargeBuffer, outputPath = `${basename(path)}.json`) {
    let finalOutput = parseObject(buf, RootBox);

    console.log(`Write to ${outputPath}`);
    writeFileSync(outputPath, prettyPrint(finalOutput));
    
    //writeFileSync(basename(path) + ".json", prettyPrint(finalOutput.boxes.filter(x => x.type === "mdat")));

    //writeFileSync(basename(path) + ".json", "test");
}

export function testWriteFile(path: string) {
    testReadFile(path);

    let oldBuf = LargeBuffer.FromFile(path);

    let finalOutput = parseObject(oldBuf, RootBox)
    let newBuf = writeObject(RootBox, finalOutput);

    testWrite(oldBuf, newBuf);

    console.log(oldBuf.getLength(), newBuf.getLength());
}
export function testWrite(oldBuf: LargeBuffer, newBuf: LargeBuffer) {
    // Compare newBuffers with output, using getBufferWriteContext to get the context of each buffer
    let bufLen = oldBuf.getLength();
    let rewriteLen = newBuf.getLength();
    let end = Math.min(bufLen, rewriteLen);

    let curErrors = 0;

    let pos = 0;
    for(let i = 0; i < end; i++) {
        let oldByte = oldBuf.readUInt8(i);
        let newByte = newBuf.readUInt8(i);

        if(oldByte !== newByte) {
            let newBuffer = newBuf.getInternalBuffer(i);
            let newContext = getBufferWriteContext(newBuffer, i);

            console.error(`Byte is wrong at position ${i}. Should be ${oldByte}, was ${newByte}. Write context ${newContext}.\nOld context ${getContext(oldBuf, i)}\nNew context ${getContext(newBuf, i)}`);
            console.error(`Byte is wrong at position ${i}. Should be ${oldByte}, was ${newByte}. Write context ${newContext}.\nOld context ${getContext(oldBuf, i, 10, true)}\nNew context ${getContext(newBuf, i, 10, true)}`);
            curErrors++;
            if(curErrors > 10) {
                throw new Error(`Too many errors (${curErrors})`);
            }
        }
    }

    if(bufLen !== rewriteLen) {
        throw new Error(`Length of buffer changed. Should be ${bufLen}, was ${rewriteLen}`);
    }

    console.log(`Files are the same`);

    function getContext(buffer: LargeBuffer, pos: number, contextSize = 32, bits = false): string {
        let beforePos = pos - contextSize;
        let beforeLength = contextSize;
        if(beforePos < 0) {
            beforeLength += beforePos;
            beforePos = 0;
        }

        let endBefore = Math.min(beforePos + contextSize, beforePos + beforeLength);

        function str(b: LargeBuffer, pos: number, before: number) {
            if(bits) {
                return range(pos, before).map(i =>
                    byteToBits(buffer.readUInt8(i)).join("")
                ).join(",");
            } else {
                return debugString(range(pos, before).map(i => buffer.readUInt8(i)));
            }
        }

        let outputBefore = str(buffer, beforePos, endBefore);
    
        let end = Math.min(pos + contextSize, buffer.getLength());
        let output = str(buffer, pos, end);

        return "\"" + outputBefore + "|" + output + "\"";
    }
}