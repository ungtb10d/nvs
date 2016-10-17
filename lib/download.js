/* global settings */
const crypto = require('crypto');
const path = require('path');

let fs = require('fs');  // Non-const enables test mocking
let http = require('http');  // Non-const enables test mocking
let https = require('https');  // Non-const enables test mocking

const nvsUse = require('./use');
const Error = require('./error');

function downloadFileAsync(filePath, fileUri, skipHeader) {
    if (!settings.quiet) {
        if (!skipHeader) console.log('Downloading...');
        console.log('  ' + fileUri + ' -> ' + nvsUse.homePath(filePath));
    }

    let stream = null;
    return new Promise((resolve, reject) => {
        try {
            stream = fs.createWriteStream(filePath);

            let client = fileUri.startsWith('https:') ? https : http;
            client.get(fileUri, (res) => {
                if (res.statusCode === 200) {
                    res.pipe(stream).on('finish', () => {
                        resolve();
                    });
                } else if (res.statusCode === 404) {
                    reject(new Error('File not available: ' + fileUri,
                        new Error('HTTP response status: ' + res.statusCode)));
                } else {
                    reject(new Error('Failed to download file: ' + fileUri,
                        new Error('HTTP response status: ' + res.statusCode)));
                }
            }).on('error', (e) => {
                reject(new Error('Failed to download file: ' + fileUri, e));
            });
        } catch (e) {
            reject(new Error('Failed to download file: ' + fileUri, e));
        }
    }).catch(e => {
        try {
            if (stream) stream.end();
            fs.unlinkSync(filePath);
        } catch (e2) {}
        throw e;
    });
}

function ensureFileCachedAsync(fileName, fileUri, shasumName, shasumUri) {
    let cachedFilePath = path.join(settings.cache, fileName);

    var fileExists;
    try {
        fs.accessSync(cachedFilePath);
        fileExists = true;
    } catch (e) {
        if (e.code !== 'ENOENT') {
            throw new Error('Cannot access cached file: ' + fileName, e);
        }
        fileExists = false;
    }

    if (shasumName && shasumUri) {
        let shasumPath = path.join(settings.cache, shasumName);

        return downloadFileAsync(shasumPath, shasumUri).then(() => {
            if (!fileExists) {
                return downloadFileAsync(cachedFilePath, fileUri, true);
            }
        }).then(() => {
            return verifyCachedFileAsync(cachedFilePath, shasumPath,
                path.posix.basename(fileUri));
        }).then(() => {
            return cachedFilePath;
        });
    } else if (!fileExists) {
        return downloadFileAsync(cachedFilePath, fileUri).then(() => {
            return cachedFilePath;
        });
    } else {
        return Promise.resolve(cachedFilePath);
    }
}

function verifyCachedFileAsync(filePath, shasumPath, fileName) {
    fileName = (fileName || path.basename(filePath)).toLowerCase();
    let fileShashum = null;
    let shasumLines = fs.readFileSync(shasumPath, 'utf8').split(/\s*\n\s*/g);
    shasumLines.forEach(line => {
        let lineParts = line.split(/ +/g);
        if (lineParts.length === 2 && lineParts[1].toLowerCase() === fileName) {
            fileShashum = lineParts[0];
            return true;
        }
    });

    if (!fileShashum) {
        throw new Error('SHASUM256 value not found for file: ' +
            path.basename(filePath));
    }

    return new Promise((resolve, reject) => {
        let fileStream = fs.createReadStream(filePath);
        let hash = crypto.createHash('sha256');
        fileStream.pipe(hash).on('finish', () => {
            var hashData = hash.read();
            if (hashData) {
                let hashResult = hashData.toString('hex');
                if (hashResult === fileShashum) {
                    resolve();
                } else {
                    fs.unlinkSync(filePath);
                    reject(new Error('SHASUM256 does not match for cached file: ' +
                        path.basename(filePath)));
                }
            } else {
                reject('Failed to caclulate hash for file: ' +
                    path.basename(filePath));
            }
        });
    });
}

module.exports = {
    downloadFileAsync,
    ensureFileCachedAsync,
};