var path = require("path");

function nativeRequire(name) {
    return eval(`require("${name}")`);
}

var entryPath = "../dist";
try {
    entryPath = path.dirname(require.resolve("mp4-typescript"));
} catch(e) {
    // Hopefully it means we are running this locally, so we can't resolve ourself. Otherwise it means
    //  the package name is wrong (or otherwise cannot be found?), and we are running as a package,
    //  and our native.node file will not be found properly.
}

module.exports = nativeRequire(entryPath + "/../build/Release/native.node");