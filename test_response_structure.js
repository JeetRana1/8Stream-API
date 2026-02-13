"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTests = exports.testMediaInfo = void 0;
// Quick test to verify the mediaInfo endpoint returns consistent structure
var axios_1 = require("axios");
var BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
function testMediaInfo(id, type, description) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function () {
        var url, response, data, hasRequiredFields, hasContent, error_1;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    console.log("\n\uD83E\uDDEA Testing: ".concat(description));
                    console.log("   ID: ".concat(id, ", Type: ").concat(type));
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, , 4]);
                    url = "".concat(BASE_URL, "/api/mediainfo?id=").concat(id, "&type=").concat(type);
                    return [4 /*yield*/, axios_1.default.get(url, { timeout: 30000 })];
                case 2:
                    response = _c.sent();
                    data = response.data;
                    hasRequiredFields = typeof data.success === 'boolean' &&
                        data.data !== undefined &&
                        Array.isArray(data.extraSources) &&
                        typeof data.source === 'string';
                    if (!hasRequiredFields) {
                        console.log('   ❌ FAIL: Missing required fields');
                        console.log('   Response:', JSON.stringify(data, null, 2));
                        return [2 /*return*/, false];
                    }
                    console.log("   \u2705 PASS: Consistent structure");
                    console.log("   Success: ".concat(data.success));
                    console.log("   Primary playlist items: ".concat(((_a = data.data.playlist) === null || _a === void 0 ? void 0 : _a.length) || 0));
                    console.log("   Alternative sources: ".concat(data.extraSources.length));
                    if (data.message) {
                        console.log("   Message: ".concat(data.message));
                    }
                    hasContent = (data.data.playlist && data.data.playlist.length > 0) ||
                        data.extraSources.length > 0;
                    console.log("   Playable: ".concat(hasContent ? 'Yes' : 'No'));
                    return [2 /*return*/, true];
                case 3:
                    error_1 = _c.sent();
                    console.log("   \u274C ERROR: ".concat(error_1.message));
                    if ((_b = error_1.response) === null || _b === void 0 ? void 0 : _b.data) {
                        console.log('   Response:', JSON.stringify(error_1.response.data, null, 2));
                    }
                    return [2 /*return*/, false];
                case 4: return [2 /*return*/];
            }
        });
    });
}
exports.testMediaInfo = testMediaInfo;
function runTests() {
    return __awaiter(this, void 0, void 0, function () {
        var tests, passed, failed, _i, tests_1, test, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('🎬 8Stream API - Response Structure Tests');
                    console.log('==========================================');
                    tests = [
                        { id: 'tt0137523', type: 'movie', desc: 'Popular movie (Fight Club)' },
                        { id: 'tt35149250', type: 'tv', desc: 'Recent TV show' },
                        { id: 'tt32897959', type: 'movie', desc: 'Less common movie' },
                        { id: 'tt99999999', type: 'movie', desc: 'Invalid/non-existent ID' },
                    ];
                    passed = 0;
                    failed = 0;
                    _i = 0, tests_1 = tests;
                    _a.label = 1;
                case 1:
                    if (!(_i < tests_1.length)) return [3 /*break*/, 5];
                    test = tests_1[_i];
                    return [4 /*yield*/, testMediaInfo(test.id, test.type, test.desc)];
                case 2:
                    result = _a.sent();
                    if (result) {
                        passed++;
                    }
                    else {
                        failed++;
                    }
                    // Wait a bit between tests
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 1000); })];
                case 3:
                    // Wait a bit between tests
                    _a.sent();
                    _a.label = 4;
                case 4:
                    _i++;
                    return [3 /*break*/, 1];
                case 5:
                    console.log('\n==========================================');
                    console.log("\uD83D\uDCCA Results: ".concat(passed, " passed, ").concat(failed, " failed"));
                    console.log('==========================================\n');
                    if (failed > 0) {
                        console.log('⚠️  Some tests failed. Check the output above for details.');
                        process.exit(1);
                    }
                    else {
                        console.log('✅ All tests passed! API is returning consistent structure.');
                        process.exit(0);
                    }
                    return [2 /*return*/];
            }
        });
    });
}
exports.runTests = runTests;
// Run if executed directly
if (require.main === module) {
    runTests().catch(function (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}
