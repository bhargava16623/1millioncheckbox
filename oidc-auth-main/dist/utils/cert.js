"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUBLIC_KEY = exports.PRIVATE_KEY = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
exports.PRIVATE_KEY = (0, node_fs_1.readFileSync)(node_path_1.default.resolve("cert/private-key.pem"));
exports.PUBLIC_KEY = (0, node_fs_1.readFileSync)(node_path_1.default.resolve("cert/public-key.pub"));
//# sourceMappingURL=cert.js.map