import { NALType, SPS, PPS, NALList, NALListRaw, NALRawType, EmulationPreventionWrapper, NAL_SPS } from "../parser-implementations/NAL";
import { TemplateToObject, SerialObject } from "../parser-lib/SerialTypes";
import { RootBox, FtypBox, MdatBox, MoofBox, StypBox, sample_flags, MoovBox, SidxBox } from "../parser-implementations/BoxObjects";
import { LargeBuffer } from "../parser-lib/LargeBuffer";
import { writeObject, parseObject } from "../parser-lib/BinaryCoder";
import { keyBy, sort } from "../util/misc";
import { min, sum } from "../util/math";

async function profile(name: string, code: () => Promise<void>): Promise<void> {
    let time = +new Date();
    try {
        await code();
    } finally {
        time = +new Date() - time;

        console.log(`${name} took ${time}ms`);
    }
}

export async function createVideo3 (
    outputFileName: string,
    videoInfo: {
        timescale: number;
        width: number;
        height: number;
        baseMediaDecodeTimeInTimescale: number;
        addMoov: boolean;
        // nalObject.type === "slice"
        frames: {
            nal: NALRawType;
            frameDurationInTimescale: number;
        }[],
        // nalObject.type === "sps"
        sps: NALRawType,
        // nalObject.type === "pps"
        pps: NALRawType
    },
): Promise<void> {
    let timescale = videoInfo.timescale;
    let width = videoInfo.width;
    let height = videoInfo.height;
    let baseMediaDecodeTimeInTimescale = videoInfo.baseMediaDecodeTimeInTimescale;

    let { frames, sps, pps } = videoInfo;

    let profile_idc!: number;
    let level_idc!: number;

    {
        let spsInfo = parseObject(sps.nalObject.nal, {obj: EmulationPreventionWrapper(sps.nalObject.nal.getLength(), NAL_SPS)}).obj;
        profile_idc = spsInfo.profile_idc;
        level_idc = spsInfo.level_idc;
    }

    if(!sps) {
        throw new Error("sps required");
    }
    if(!pps) {
        throw new Error("pps required");
    }
   
    let codec = `avc1.${profile_idc.toString(16)}00${level_idc.toString(16)}`;

    //let frames = NALs.filter(x => x.nalObject.type === "slice");
    let frameInfos = frames.map((input, i) => {
        let obj = input.nal.nalObject;
        if(obj.type !== "slice") throw new Error("impossible");
        
        // Hmm... have to call write to write the nal header stuff.
        let buffer = writeObject(NALListRaw(4), { NALs: [input.nal] });

        return {
            buffer: buffer,
            composition_offset: 0,
            frameDurationInTimescale: input.frameDurationInTimescale
        };
    });

    let samples: SampleInfo[] = frameInfos.map(x => ({
        sample_size: x.buffer.getLength(),
        sample_composition_time_offset: x.composition_offset,
    }));

    let variableFrameRate = false;
    let defaultSampleDuration = frameInfos.length > 0 ? frameInfos[0].frameDurationInTimescale : 0;
    for(let frameInfo of frameInfos) {
        if(frameInfo.frameDurationInTimescale !== defaultSampleDuration) {
            variableFrameRate = true;
            break;
        }
    }
    if(variableFrameRate) {
        for(let i = 0; i < samples.length; i++) {
            samples[i].sample_duration = frameInfos[i].frameDurationInTimescale;
        }
    }


    let boxes: TemplateToObject<typeof RootBox>["boxes"][0][] = [];

    if(videoInfo.addMoov) {
        let ftyp: O<typeof FtypBox> = {
            header: {
                type: "ftyp"
            },
            type: "ftyp",
            major_brand: "iso5",
            minor_version: 1,
            compatible_brands: [
                "avc1",
                "iso5",
                "dash"
            ]
        };
        boxes.push(ftyp);


        let moov = createMoov({
            defaultFlags: nonKeyFrameSampleFlags,
            timescale: timescale,
            durationInTimescale: 0,
            width: width,
            height: height,
            AVCProfileIndication: profile_idc,
            profile_compatibility: 0,
            AVCLevelIndication: level_idc,
            sps: sps.nalObject.nal,
            pps: pps.nalObject.nal,
            defaultSampleDuration: defaultSampleDuration,
        });
        boxes.push(moov);
    }
    
    let moof = createMoof({
        sequenceNumber: 1,
        baseMediaDecodeTimeInTimescale: baseMediaDecodeTimeInTimescale,
        samples,
        forcedFirstSampleFlags: keyFrameSampleFlags,
        // Set defaultFlags in moov, not moof
        //defaultSampleFlags: nonKeyFrameSampleFlags
    });
    
    let mdat: O<typeof MdatBox> = {
        header: {
            size: 0,
            headerSize: 8,
            type: "mdat"
        },
        type: "mdat",
        bytes: new LargeBuffer(frameInfos.map(x => x.buffer))
    };

    let moofBuf = writeObject(MoofBox, moof);
    let mdatBuf = writeObject(MdatBox, mdat);

    let sidx = createSidx({
        moofSize: moofBuf.getLength(),
        mdatSize: mdatBuf.getLength(),
        subsegmentDuration: sum(frameInfos.map(x => x.frameDurationInTimescale)),
        timescale: timescale,
        startsWithKeyFrame: true
    });

    let styp: O<typeof StypBox> = {
        header: {
            size: 24,
            type: "styp",
            headerSize: 8
        },
        type: "styp",
        major_brand: "msdh",
        minor_version: 0,
        compatible_brands: [
            "msdh",
            "msix"
        ]
    };

    boxes.push(styp);
    boxes.push(sidx);
    boxes.push(moof);
    boxes.push(mdat);

    let outputBuffers: {buf: LargeBuffer, type: string}[] = [];
    for(let box of boxes) {
        let buf = writeObject(RootBox, { boxes: [box] });
        outputBuffers.push({
            buf,
            type: box.type
        });
    }

    let finalBuffer = new LargeBuffer(outputBuffers.map(x => x.buf));

    /*
    let totalSize = finalBuffer.getLength();
    sort(outputBuffers, x => -x.buf.getLength());
    console.log(`Total size ${totalSize}`);
    for(let output of outputBuffers) {
        console.log(`\t${output.type}, size ${output.buf.getLength()}`);
    }
    */

    await finalBuffer.WriteToFile(outputFileName);
}



const keyFrameSampleFlags: SampleFlags = {
    reserved: 0,
    is_leading: 0,
    sample_depends_on: 0,
    sample_is_depended_on: 0,
    sample_has_redundancy: 0,
    sample_padding_value: 0,
    // This resets the default in trex which sets sample_is_non_sync_sample to 1.
    //  So this essentially says this is a sync sample, AKA, a key frame (reading this
    //  frames syncs the video, so we can just read forward from any sync frame).
    sample_is_non_sync_sample: 0,
    sample_degradation_priority: 0
};

const nonKeyFrameSampleFlags: SampleFlags = {
    reserved: 0,
    is_leading: 0,
    sample_depends_on: 0,
    sample_is_depended_on: 0,
    sample_has_redundancy: 0,
    sample_padding_value: 0,
    sample_is_non_sync_sample: 1,
    sample_degradation_priority: 0
};

type O<T extends SerialObject> = TemplateToObject<T>;
type SampleFlags = O<{x: typeof sample_flags}>["x"];

function createMoov(
    d: {
        defaultFlags: SampleFlags;
        timescale: number;
        durationInTimescale: number;
        width: number;
        height: number;
        AVCProfileIndication: number;
        profile_compatibility: number;
        AVCLevelIndication: number;
        sps: LargeBuffer,
        pps: LargeBuffer,
        defaultSampleDuration: number;
    }
): O<typeof MoovBox> {
    if("time_scale" in d.sps) {
        //d.sps.time_scale = d.timescale * 2;
    }
    if("num_units_in_tick" in d.sps) {
        //d.sps.num_units_in_tick = d.frameTimeInTimescale;
    }
    
    return {
        header: {
            type: "moov"
        },
        type: "moov",
        boxes: [
            {
                header: {
                    type: "mvhd"
                },
                type: "mvhd",
                version: 0,
                flags: 0,
                times: {
                    creation_time: 0,
                    modification_time: 0,
                    timescale: d.timescale,
                    duration: d.durationInTimescale
                },
                rate: 1,
                volume: 1,
                reserved: 0,
                reserved0: 0,
                reserved1: 0,
                matrix: [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824],
                pre_defined: [0, 0, 0, 0, 0, 0],
                next_track_ID: 2
            },
            {
                header: {
                    type: "mvex"
                },
                type: "mvex",
                boxes: [
                    // Gives the total time of the video in the browser
                    /*
                    {
                        header: {
                            size: 16,
                            type: "mehd",
                            headerSize: 8
                        },
                        type: "mehd",
                        version: 0,
                        flags: 0,
                        time: {
                            fragment_duration: d.frameTimeInTimescale * 30
                        }
                    },
                    //*/
                    {
                        header: {
                            type: "trex"
                        },
                        type: "trex",
                        version: 0,
                        flags: 0,
                        track_ID: 1,
                        // Index of sample information in stsd. Could be used to change width/height?
                        default_sample_description_index: 1,
                        default_sample_duration: d.defaultSampleDuration,
                        default_sample_size: 0,
                        default_sample_flags: d.defaultFlags
                    }
                ]
            },
            {
                header: {
                    type: "trak"
                },
                type: "trak",
                boxes: [
                    {
                        header: {
                            type: "tkhd"
                        },
                        type: "tkhd",
                        version: 0,
                        flags: {
                            reserved: 0,
                            track_size_is_aspect_ratio: 0,
                            track_in_preview: 0,
                            track_in_movie: 1,
                            track_enabled: 1
                        },
                        times: {
                            creation_time: 0,
                            modification_time: 0,
                            track_ID: 1,
                            reserved: 0,
                            duration: 0
                        },
                        reserved0: 0,
                        reserved1: 0,
                        layer: 0,
                        alternate_group: 0,
                        volume: 0,
                        reserved2: 0,
                        matrix: [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824],
                        width: d.width,
                        height: d.height,
                    },
                    {
                        header: {
                            type: "mdia"
                        },
                        type: "mdia",
                        boxes: [
                            {
                                header: {
                                    type: "mdhd"
                                },
                                type: "mdhd",
                                version: 0,
                                flags: 0,
                                creation_time: 0,
                                modification_time: 0,
                                timescale: d.timescale,
                                duration: 0,
                                language: "und",
                                pre_defined: 0
                            },
                            {
                                header: {
                                    type: "hdlr"
                                },
                                type: "hdlr",
                                version: 0,
                                flags: 0,
                                pre_defined: 0,
                                handler_type: "vide",
                                reserved: [0,0,0],
                                name: "VideoHandler"
                            },
                            {
                                header: {
                                    type: "minf"
                                },
                                type: "minf",
                                boxes: [
                                    {
                                        header: {
                                            type: "vmhd"
                                        },
                                        type: "vmhd",
                                        version: 0,
                                        flags: 1,
                                        graphicsmode: 0,
                                        opcolor: [0, 0, 0]
                                    },
                                    {
                                        header: {
                                            type: "dinf"
                                        },
                                        type: "dinf",
                                        boxes: [
                                            {
                                                header: {
                                                    type: "dref"
                                                },
                                                type: "dref",
                                                version: 0,
                                                flags: 0,
                                                entry_count: 1,
                                                boxes: [
                                                    {
                                                        header: {
                                                            type: "url "
                                                        },
                                                        type: "url ",
                                                        version: 0,
                                                        flags: {
                                                            reserved: 0,
                                                            media_is_in_same_file: 1
                                                        }
                                                    }
                                                ]
                                            }
                                        ]
                                    },
                                    {
                                        header: {
                                            type: "stbl"
                                        },
                                        type: "stbl",
                                        boxes: [
                                            {
                                                header: {
                                                    type: "stsd"
                                                },
                                                type: "stsd",
                                                version: 0,
                                                flags: 0,
                                                entry_count: 1,
                                                boxes: [
                                                    {
                                                        "header": {
                                                            "size": 153,
                                                            "type": "avc1",
                                                            "headerSize": 8
                                                        },
                                                        "type": "avc1",
                                                        "reserved": [
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0
                                                        ],
                                                        "data_reference_index": 1,
                                                        "pre_defined": 0,
                                                        "reserved1": 0,
                                                        "pre_defined1": [
                                                            0,
                                                            0,
                                                            0
                                                        ],
                                                        width: d.width,
                                                        height: d.height,
                                                        // DPI. Useless, and always constant
                                                        horizresolution: 0x00480000,
                                                        vertresolution: 0x00480000,
                                                        "reserved2": 0,
                                                        "frame_count": 1,
                                                        "compressorname": [
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0,
                                                            0
                                                        ],
                                                        "depth": 24,
                                                        "pre_defined2": -1,
                                                        "boxes": [
                                                            {
                                                                "header": {
                                                                    "size": 51,
                                                                    "type": "avcC",
                                                                    "headerSize": 8
                                                                },
                                                                "type": "avcC",
                                                                "configurationVersion": 1,
                                                                AVCProfileIndication: d.AVCProfileIndication,
                                                                profile_compatibility: d.profile_compatibility,
                                                                AVCLevelIndication: d.AVCLevelIndication,
                                                                "reserved0": [
                                                                    1,
                                                                    1,
                                                                    1,
                                                                    1,
                                                                    1,
                                                                    1
                                                                ],
                                                                "lengthSizeMinusOne": 3,
                                                                "reserved1": [
                                                                    1,
                                                                    1,
                                                                    1
                                                                ],
                                                                "numOfSequenceParameterSets": 1,
                                                                "sequenceParameterSets": [
                                                                    {
                                                                        "sps": {
                                                                            "NALLength": {
                                                                                "size": 29
                                                                            },
                                                                            "bitHeader0": {
                                                                                "forbidden_zero_bit": 0,
                                                                                "nal_ref_idc": 3,
                                                                                "nal_unit_type": 7
                                                                            },
                                                                            "forbidden_zero_bit_check": {},
                                                                            "extension": {
                                                                                "nalUnitHeaderBytes": 1
                                                                            },
                                                                            "nalObject": {
                                                                                "type": "sps",
                                                                                "nal": d.sps
                                                                            }
                                                                        }
                                                                    }
                                                                ],
                                                                "test": 5,
                                                                "numOfPictureParameterSets": 1,
                                                                "pictureParameterSets": [
                                                                    {
                                                                        "pps": {
                                                                            "NALLength": {
                                                                                "size": 7
                                                                            },
                                                                            "bitHeader0": {
                                                                                "forbidden_zero_bit": 0,
                                                                                "nal_ref_idc": 3,
                                                                                "nal_unit_type": 8
                                                                            },
                                                                            "forbidden_zero_bit_check": {},
                                                                            "extension": {
                                                                                "nalUnitHeaderBytes": 1
                                                                            },
                                                                            "nalObject": {
                                                                                "type": "pps",
                                                                                "nal": d.pps
                                                                            }
                                                                        }
                                                                    }
                                                                ],
                                                                "remainingBytes": []
                                                            },
                                                            {
                                                                "header": {
                                                                    "size": 16,
                                                                    "type": "pasp",
                                                                    "headerSize": 8
                                                                },
                                                                "type": "pasp",
                                                                "hSpacing": 1,
                                                                "vSpacing": 1
                                                            }
                                                        ]
                                                    }
                                                ]
                                            },
                                            {
                                                header: {
                                                    type: "stts"
                                                },
                                                type: "stts",
                                                version: 0,
                                                flags: 0,
                                                entry_count: 0,
                                                samples: []
                                            },
                                            {
                                                header: {
                                                    type: "stsc"
                                                },
                                                type: "stsc",
                                                version: 0,
                                                flags: 0,
                                                entry_count: 0,
                                                entries: []
                                            },
                                            {
                                                header: {
                                                    type: "stsz"
                                                },
                                                type: "stsz",
                                                version: 0,
                                                flags: 0,
                                                sample_size: 0,
                                                sample_count: 0,
                                                sample_sizes: []
                                            },
                                            {
                                                header: {
                                                    type: "stco"
                                                },
                                                type: "stco",
                                                version: 0,
                                                flags: 0,
                                                entry_count: 0,
                                                chunk_offsets: []
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }
        ]
    };
}

function createSidx(
    d: {
        moofSize: number;
        mdatSize: number;
        subsegmentDuration: number;
        timescale: number;
        startsWithKeyFrame: boolean;
    }
): O<typeof SidxBox> {
    // There is a sidx per moof and mdat.
    return {
        header: {
            type: "sidx"
        },
        type: "sidx",
        version: 0,
        flags: 0,
        reference_ID: 1,
        timescale: d.timescale,
        times: {
            // Not used, doesn't matter?
            earliest_presentation_time: 0,
            // Not useful, we can just use reference_offset
            first_offset: 0
        },
        reserved: 0,
        reference_count: 1,
        ref: [
            // Nothing in here matters except reference_offset, and MAYBE subsegment_duration, but I am not even convinced of that.
            {
                // The whole SAP and reference_type garbage doesn't matter. Just put 0s, which means "no information of SAPs is provided",
                //  and use sample_is_non_sync_sample === 0 to indicate SAPs. Also, sample_is_non_sync_sample is used anyway, so these values
                //  are overriden regardless of what we do.
                a: {
                    reference_type: 0,
                    reference_offset: d.moofSize + d.mdatSize
                },
                // Looks like this isn't used. But we could calculate it correctly, instead of however it was calculated by mp4box
                subsegment_duration: d.subsegmentDuration,
                SAP: {
                    starts_with_SAP: d.startsWithKeyFrame ? 1 : 0,
                    // a SAP of type 1 or type 2 is indicated as a sync sample, or by "sample_is_non_sync_sample" equal to 0 in the movie fragments.
                    //  So... we have sample_is_non_sync_sample === 0 in the movie fragments, so this can be 0 here.
                    SAP_type: d.startsWithKeyFrame ? 1 : 0,
                    SAP_delta_time: 0
                }
            }
        ]
    };
}

type SampleInfo = {
    sample_duration?: number;
    sample_size?: number;
    sample_flags?: SampleFlags;
    sample_composition_time_offset?: number;
}
function createMoof(
    d: {
        // Order of the moof. Counting starts at 1.
        sequenceNumber: number;
        baseMediaDecodeTimeInTimescale: number;
        samples: SampleInfo[];
        forcedFirstSampleFlags?: SampleFlags;
        defaultSampleDurationInTimescale?: number;
        defaultSampleFlags?: SampleFlags;
    }
): O<typeof MoofBox> {

    let sample_durations = d.samples.filter(x => x.sample_duration !== undefined).length;
    let sample_sizes = d.samples.filter(x => x.sample_size !== undefined).length;
    let sample_flagss = d.samples.filter(x => x.sample_flags !== undefined).length;
    let sample_composition_time_offsets = d.samples.filter(x => x.sample_composition_time_offset !== undefined).length;

    if(sample_durations !== 0 && sample_durations !== d.samples.length) {
        throw new Error(`Some samples have sample_duration, others don't. This is invalid, samples must be consistent.`);
    }
    if(sample_sizes !== 0 && sample_sizes !== d.samples.length) {
        throw new Error(`Some samples have sample_size, others don't. This is invalid, samples must be consistent.`);
    }
    if(sample_flagss !== 0 && sample_flagss !== d.samples.length) {
        throw new Error(`Some samples have sample_flags, others don't. This is invalid, samples must be consistent. Even if there is a forceFirstSampleFlags, either ever sample needs flags, or none should have it.`);
    }
    if(sample_composition_time_offsets !== 0 && sample_composition_time_offsets !== d.samples.length) {
        throw new Error(`Some samples have sample_composition_time_offset, others don't. This is invalid, samples must be consistent.`);
    }

    let has_sample_durations = sample_durations > 0;
    let has_sample_sizes = sample_sizes > 0;
    let has_sample_flags = sample_flagss > 0;
    let has_composition_offsets = sample_composition_time_offsets > 0;

    function createMoofInternal(moofSize: number) {
        let moof: O<typeof MoofBox> = {
            header: {
                type: "moof"
            },
            type: "moof",
            boxes: [
                {
                    header: {
                        type: "mfhd"
                    },
                    type: "mfhd",
                    version: 0,
                    flags: 0,
                    sequence_number: d.sequenceNumber
                },
                {
                    header: {
                        type: "traf"
                    },
                    type: "traf",
                    boxes: [
                        {
                            header: {
                                type: "tfhd"
                            },
                            type: "tfhd",
                            version: 0,
                            flags: {
                                reserved3: 0,
                                default_base_is_moof: 1,
                                duration_is_empty: 0,
                                reserved2: 0,
                                // Eh... there is no reason to set this, as we can set the default flags in the moov (trex) anyway.
                                default_sample_flags_present: d.defaultSampleFlags === undefined ? 0 : 1,
                                // I can't imagine all samples having the same size, so let's not even set this.
                                default_sample_size_present: 0,
                                //  Also set in trex, but we MAY have different durations for different chunks.
                                default_sample_duration_present: d.defaultSampleDurationInTimescale === undefined ? 0 : 1,
                                reserved1: 0,
                                sample_description_index_present: 0,
                                base_data_offset_present: 0
                            },
                            track_ID: 1,
                            values: Object.assign({},
                                d.defaultSampleDurationInTimescale === undefined ? {} : { default_sample_duration: d.defaultSampleDurationInTimescale },
                                d.defaultSampleFlags === undefined ? {} : { default_sample_flags: d.defaultSampleFlags }
                            )
                        },
                        {
                            header: {
                                type: "tfdt"
                            },
                            type: "tfdt",
                            version: 1,
                            flags: 0,
                            values: {
                                baseMediaDecodeTime: d.baseMediaDecodeTimeInTimescale
                            }
                        },
                        {
                            header: {
                                type: "trun"
                            },
                            type: "trun",
                            version: 0,
                            flags: {
                                reserved2: 0,
                                sample_composition_time_offsets_present: has_composition_offsets ? 1 : 0,
                                sample_flags_present: has_sample_flags ? 1 : 0,
                                sample_size_present: has_sample_sizes ? 1 : 0,
                                sample_duration_present: has_sample_durations ? 1 : 0,
                                reserved1: 0,
                                first_sample_flags_present: d.forcedFirstSampleFlags === undefined ? 0 : 1,
                                reserved0: 0,
                                data_offset_present: 1
                            },
                            sample_count: d.samples.length,
                            values: Object.assign(
                                { data_offset: moofSize + 8 },
                                // Union assignment has bugs, so... this is sort of weird
                                d.forcedFirstSampleFlags === undefined ? {
                                    first_sample_flags: undefined
                                } : {
                                    first_sample_flags: d.forcedFirstSampleFlags
                                }
                            ),
                            sample_values: d.samples
                        }
                    ]
                }
            ]
        };
        return moof;
    }

    let size = writeObject(MoofBox, createMoofInternal(0)).getLength();
    let moof = createMoofInternal(size);

    return moof;
}

function getSamples(NALs: NALRawType[], frameTimeInTimescale: number) {
    let frames = NALs.filter(x => x.nalObject.type === "slice");

    let picOrders: { fileIndex: number; picOrder: number }[] = [];

    /*
    if(!(sps instanceof LargeBuffer) && !(pps instanceof LargeBuffer) && "log2_max_pic_order_cnt_lsb_minus4" in sps && sps.log2_max_pic_order_cnt_lsb_minus4 ) {
        let MaxPicOrderCntLsb = Math.pow(2, sps.log2_max_pic_order_cnt_lsb_minus4 + 4);
        let prevPicOrderCntLsb = 0;
        let prevPicOrderCntMsb = 0;
        //sps.max_num_reorder_frames
        frames.forEach((obj, i) => {
            let input = obj.nalObject;
            if(input.type !== "slice") throw new Error("impossible");
            let pic_order_cnt_lsb = input.nal.slice_header.pic_order_cnt_lsb;

            let PicOrderCntMsb: number;

            // This is the algorithm from the spec
            if (pic_order_cnt_lsb < prevPicOrderCntLsb && (prevPicOrderCntLsb - pic_order_cnt_lsb) >= (MaxPicOrderCntLsb / 2)) {
                PicOrderCntMsb = prevPicOrderCntMsb + MaxPicOrderCntLsb;
            }
            else if( ( pic_order_cnt_lsb > prevPicOrderCntLsb ) &&
                ( ( pic_order_cnt_lsb - prevPicOrderCntLsb ) > ( MaxPicOrderCntLsb / 2 ) ) ) {
                PicOrderCntMsb = prevPicOrderCntMsb - MaxPicOrderCntLsb;
            } else {
                PicOrderCntMsb = prevPicOrderCntMsb;
            }

            prevPicOrderCntLsb = pic_order_cnt_lsb;
            prevPicOrderCntMsb = PicOrderCntMsb;

            let picOrder = prevPicOrderCntMsb + prevPicOrderCntLsb;

            picOrders.push({
                fileIndex: i,
                picOrder: picOrder,
            });
        });

        sort(picOrders, x => x.picOrder);
    }
    */

    let orderOffsets = keyBy(
        picOrders.map((x, finalIndex) => ({
            offset: finalIndex - x.fileIndex,
            fileIndex: x.fileIndex,
        })),
        x => x.fileIndex.toString()
    );

    let samples = frames.map((input, i) => {
        let obj = input.nalObject;
        if(obj.type !== "slice") throw new Error("impossible");
        let buffer = writeObject(NALListRaw(4), { NALs: [input] });
        //let header = obj.nal.slice_header;

        let comp_off = i in orderOffsets ? orderOffsets[i].offset * frameTimeInTimescale : 0;

        return {
            buffer: buffer,
            // Hmm... maybe calculate this, and also try to speed up the video, or slow it down, and make sure time information
            //  in the NALs is ignore, and doesn't break the video.
            composition_offset: comp_off // frames[i].composition_offset,
        };
    });

    let negativeOffset = min(samples.map(x => x.composition_offset));
    if(negativeOffset < 0) {
        samples.forEach(sample => {
            sample.composition_offset -= negativeOffset;
        });
    }

    return samples;
}