var fs = require("fs");
var webpack = require("webpack");
var path = require("path");
var nodeExternals = require("webpack-node-externals");

module.exports = env => {
    return [getConfig(env)];
}

function getConfig (env) {
    let node = env && !!env.node || false;

    let obj = {
        mode: "development",
        entry: {
            index: "./src/mp4-typescript.ts"
        },
        output: {
            filename: "./mp4-typescript.js",
            libraryTarget: "commonjs2"
        },

        // Enable sourcemaps for debugging webpack's output.
        devtool: "source-map",

        resolve: {
            // Add '.ts' and '.tsx' as resolvable extensions.
            extensions: [".webpack.js", ".web.js", ".ts", ".tsx", ".js"],
            modules: ['node_modules'],
        },

        module: {
            rules: [
                // All files with a '.ts' or '.tsx' extension will be handled by 'ts-loader'.
                { test: /\.tsx?$/, loader: "ts-loader" },
                { test: /\.less$/, loader: "style-loader!css-loader!less-loader" },
                { enforce: 'pre', test: /\.js$/, loader: "source-map-loader" },
            ]
        },

        plugins: [
            new webpack.DefinePlugin({
                TEST: false
            }),
        ],

        node: { __dirname: false },
    };

    if (node) {
        obj["target"] = "node";
        obj["externals"] = [nodeExternals()];
    }

    return obj;
};