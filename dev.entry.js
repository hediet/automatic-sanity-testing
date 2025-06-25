const { enableHotReload } = require("@hediet/node-reload/node");
enableHotReload({ entryModule: module, logging: true });
const { hotReloadExportedItem } = require("@hediet/node-reload");

const { run } = require("./src/index.entry");

hotReloadExportedItem(run, r => {
    return r();
});

setInterval(() => {

}, 1000);

