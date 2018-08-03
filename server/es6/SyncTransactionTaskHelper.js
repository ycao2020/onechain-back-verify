import config from './config';
import {dbconnectionManager} from './DBConnectionManager';
import moment from 'moment';
import fs from 'fs';
import path from 'path';
import url from 'url';
import http from 'http';
import https from 'https';
import {requestHelper} from './RequestHelper';
import {backChainUtil} from  './BackChainUtil';
import "isomorphic-fetch";
import { settingsHelper } from './SettingsHelper';
import { receiveTransactionsTask } from './ReceiveTransactionsTask';

let syncing = false;
let pendingResets = [];
let pendingAttachments = {};

let adapter = function() {
    let adapters = {
        'http:': http,
        'https:': https
    };

    return function(inputUrl) {
        return adapters[url.parse(inputUrl).protocol];
    }
}();

/*
 Helper class contains synch related APIs
*/
class SyncTransactionTaskHelper {

        constructor() {}

        startSyncing(opts) {
            this.opts = opts;

            settingsHelper.getApplicationSettings()
                .then(result => {
                    if(result && result.chainOfCustidy
                        && result.chainOfCustidy.authenticationToken
                        && result.chainOfCustidy.chainOfCustodyUrl) {
                        console.info('Chain of Custody data will be synced roughly every ' + config.syncDataIntervalInMillis + ' milliseconds');
                        this.syncMessages(result.chainOfCustidy.authenticationToken, result.chainOfCustidy.chainOfCustodyUrl, result.chainOfCustidy.lastSyncTimeInMillis);
                    }
                })
                .catch(err => {
                    console.error("Application Settings can't be read: " + err);
                });
        }

        syncMessages(authenticationToken, chainOfCustodyUrl, lastSyncTimeInMillis) {
            if(syncing) {
                return;
            }
            syncing = true;

            if(Object.keys(pendingAttachments).length > 0) {
                this.downloadAttachment(authenticationToken, chainOfCustodyUrl).then(result => {
                    syncing = false;
                    this.syncMessages(authenticationToken, chainOfCustodyUrl);
                });
            }
            else if(pendingResets.length > 0) {
                this.makeResetRequest().then(result => {
                    syncing = false;
                    this.syncMessages(authenticationToken, chainOfCustodyUrl);
                });
            }
            else {
                this.makeConsumeRequest(authenticationToken, chainOfCustodyUrl).then(result => {
                    syncing = false;

                    if(result.transactionMessages.length) {
                        let transactionMessages;
                        if(this.opts.createSyncGaps) {
                            // This is a test mode where sync gaps are created by discarding a percentage
                            // of received transaction messages; once several gaps are created, the
                            // server can be re-run without this mode to sync them.
                            transactionMessages = [];
                            for(let transactionMessage of result.transactionMessages) {
                                if(Math.random() >= 0.5) {
                                    transactionMessages.push(transactionMessage);
                                }
                            }
                            console.log("Discarded " + (result.transactionMessages.length - transactionMessages.length) + " messages to create sync gaps");
                        }
                        else {
                            transactionMessages = result.transactionMessages;
                        }

                        this.processMessagesForAttachments(transactionMessages);
                        receiveTransactionsTask.insertMessages(transactionMessages);
                    }

                    receiveTransactionsTask.insertOrUpdateSettings(authenticationToken, chainOfCustodyUrl, lastSyncTimeInMillis);
                    if(result.hasMorePages || pendingResets.length > 0 || Object.keys(pendingAttachments).length > 0) {
                        setTimeout(() => {
                            this.syncMessages(authenticationToken, chainOfCustodyUrl);
                        }, 1000);
                    }
                    else {
                        setTimeout(() => {
                            this.syncMessages(authenticationToken, chainOfCustodyUrl);
                        }, config.syncDataIntervalInMillis);
                    }
                }).catch(err => {
                    syncing = false;
                    console.log('Encountered error: ' + err);

                    // Try again on the next sync interval.
                    setTimeout(() => {
                        this.syncMessages(authenticationToken, chainOfCustodyUrl);
                    }, config.syncDataIntervalInMillis);
                });
            }
        }

        makeConsumeRequest(authenticationToken, chainOfCustodyUrl) {
            return fetch(backChainUtil.returnValidURL(chainOfCustodyUrl + '/oms/rest/backchain/v1/consume', { limitInKb: 1024 }), {
                method: 'get',
                headers: new Headers({
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'token ' + authenticationToken
                })
            }).then(response => {
                return response.json();
            }).then(result => {
                if(!result) {
                    throw new Error("Response was empty");
                }
                if(!result.transactionMessages) {
                    throw new Error("Response was not successful: " + JSON.stringify(result));
                }

                console.log('Received ' + result.transactionMessages.length + ' messages');
                return result;
            });
        }

        makeResetRequest() {
            const request = pendingResets.pop();
            let updateSyncStatistics = false;
            let baseUrl = request.chainOfCustodyUrl + '/oms/rest/backchain/v1/reset';
            let url;
            let localToUTCTimeInMillis = null;
            if (request.fromDate) {
                localToUTCTimeInMillis = parseInt(request.fromDate, 10) + (-1 * parseInt(request.offset) * 60000);
                let dateAsString = moment(new Date(localToUTCTimeInMillis)).format('YYYYMMDD');
                url = backChainUtil.returnValidURL(baseUrl, { fromDate: dateAsString });
                console.log('Sync from date: ' + dateAsString);
                updateSyncStatistics = true;
            }
            else if(request.fromSequence) {
                url = backChainUtil.returnValidURL(baseUrl, {
                    fromSequence: request.fromSequence,
                    toSequence: request.toSequence
                });
                 updateSyncStatistics = true;
                console.log('Sync gap: ' + request.fromSequence + (request.toSequence ? (" - " + request.toSequence) : ""));
            }
            else {
                return new Promise(resolve => resolve({ success: true }));
            }

            return fetch(url, {
                method: 'get',
                headers: new Headers({
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'token ' + request.authenticationToken
                })
            }).then(response => {
                return response.json();
            }).then(result => {
                if(!result) {
                    throw new Error("Response was empty");
                }
                if(!result.success) {
                    throw new Error("Request was not successful: " + JSON.stringify(result));
                }

                // update SyncStatistics
                if (updateSyncStatistics) {
                    settingsHelper.getSyncStatisticsInfo()
                         .then((syncStatisticsInfo) => {
                             if (syncStatisticsInfo.syncStatisticsExists === false) {
                                 updateSyncStatistics = true;
                                 syncStatisticsInfo.syncStatistics = {
                                     "earliestSyncDateInMillis": null,
                                     "earliestSyncSequenceNo": null,
                                     "latestSyncDateInMillis": null,
                                     "latestSyncSequenceNo": null,
                                     "gaps": [],
                                     "earliestResetDateInMillis": parseInt(request.fromDate, 10)
                                 };
                             } else {
                                 if (request.fromDate) {
                                    if (parseInt(request.fromDate, 10) < syncStatisticsInfo.syncStatistics.earliestResetDateInMillis) {
                                        syncStatisticsInfo.syncStatistics.earliestResetDateInMillis = parseInt(request.fromDate, 10);
                                        updateSyncStatistics = true;
                                    } else {
                                        updateSyncStatistics = false;
                                    }
                                 }
                             }
                             if (updateSyncStatistics) {
                                settingsHelper.updateSyncStatistics(syncStatisticsInfo.syncStatistics);
                             }
                         })
                         .catch((err) => {
                             console.error("Error occurred while updating SyncStatistics: " + err);
                             callback(err, null);
                        });
                }

                return this.updateChainOfCustody(request.authenticationToken, request.chainOfCustodyUrl, result.entName, localToUTCTimeInMillis, result => {
                    if(!result) {
                        throw new Error("Response was empty");
                    }
                    if(!result.chainOfCustidy) {
                        throw new Error("Request was not successful: " + JSON.stringify(result));
                    }

                    result.chainOfCustidy.success = true;
                    if (request.callback) {
                        request.callback(null, result.chainOfCustidy);
                    }
                });
            }).catch(function (err) {
                console.log(err);
                if (request.callback) {
                    request.callback(err, null);
                }
            });
        }

        downloadAttachment(authenticationToken, chainOfCustodyUrl) {
            return new Promise((resolve, reject) => {
                let pendingAttachmentIds = Object.keys(pendingAttachments);

                // Check that there are pending attachments.
                if(!pendingAttachmentIds.length) {
                    resolve();
                    return;
                }

                let attachmentsDir = path.resolve(__dirname, "../", "attachments");
                if (!fs.existsSync(attachmentsDir)) {
                    fs.mkdirSync(attachmentsDir);
                }

                let pendingAttachment = pendingAttachments[pendingAttachmentIds[0]];
                let fileName = pendingAttachment.id.replace(/[\/\\]/g, '_');
                let filePath = attachmentsDir + "/" + fileName;

                // Check that the attachment isn't already downloaded.
                if (fs.existsSync(filePath)) {
                    delete pendingAttachments[pendingAttachment.id];
                    resolve();
                    return;
                }

                console.log('Downloading attachment ' + pendingAttachment.id);

                let attachmentUrl = backChainUtil.returnValidURL(chainOfCustodyUrl + '/oms/rest/backchain/v1/attachment', {
                    transactionId: pendingAttachment.txnId,
                    transactionSliceHash: pendingAttachment.txnSliceHash,
                    sequence: pendingAttachment.txnSequence,
                    businessTransactionId: pendingAttachment.businessTxnId,
                    attachmentId: pendingAttachment.id
                });
                let options = url.parse(attachmentUrl);
                console.log(options);
                options.headers = {
                    Authorization: 'token ' + authenticationToken
                };

                // Create the file and try to download the contents.
                let file = fs.createWriteStream(filePath);
                let request = adapter(attachmentUrl).get(options, response => {
                    response.pipe(file);

                    const { statusCode } = response;
                    if(statusCode != 200) {
                        console.log('Failed to download attachment ' + pendingAttachment.id + ', statusCode: ' + statusCode);
                    }

                    file.on('finish', () => {
                        delete pendingAttachments[pendingAttachment.id];
                        resolve();
                    }).on('error', err => {
                        // Delete the file.
                        fs.unlink(filePath);

                        console.log('Failed to download attachment ' + pendingAttachment.id + ' for txn '
                            + pendingAttachment.txnId + ' and business txn ' + pendingAttachment.businessTxnId);
                        resolve();
                    });
                });
            });
        }

        processMessagesForAttachments(transactionMessages) {
            for(let i = 0; i < transactionMessages.length; i++) {
                let transactionMessage = transactionMessages[i];
                let transactionSlice = JSON.parse(transactionMessage.transactionSliceString);
                for(let j = 0; j < transactionSlice.businessTransactions.length; j++) {
                    let businessTransaction = transactionSlice.businessTransactions[j];
                    if(!businessTransaction.Attachments) {
                        continue;
                    }

                    for(let k in businessTransaction.Attachments) {
                        let attachmentArr = businessTransaction.Attachments[k];
                        for(let l = 0; l < attachmentArr.length; l++) {
                            let id = attachmentArr[l].id;
                            if(!pendingAttachments[id]) {
                                let att = pendingAttachments[id] = attachmentArr[l];
                                att.txnId = transactionMessage.id;
                                att.txnSliceHash = transactionMessage.transactionSliceHash;
                                att.txnSequence = transactionMessage.sequence;
                                att.businessTxnId = businessTransaction.btid;
                            }
                        }
                    }
                }
            }
        }

        startSyncFromCertainDate(authenticationToken, fromDate, chainOfCustodyUrl, offset, callback) {
            pendingResets.unshift({
                authenticationToken: authenticationToken,
                chainOfCustodyUrl: chainOfCustodyUrl,
                fromDate: fromDate,
                offset: offset,
                callback: callback
            });
            this.syncMessages(authenticationToken, chainOfCustodyUrl);
        }

        startGapSync(authenticationToken, chainOfCustodyUrl, gaps, callback) {
            for(let i = 0; i < gaps.length; i++) {
                pendingResets.unshift({
                    authenticationToken: authenticationToken,
                    chainOfCustodyUrl: chainOfCustodyUrl,
                    fromSequence: gaps[i].fromSequenceNo,
                    toSequence: gaps[i].toSequenceNo,

                    // UI shouldn't wait for all the gap sync requests to return with a response.
                    callback: i == 0 ? callback : null
                });
            }
            this.syncMessages(authenticationToken, chainOfCustodyUrl);
        }

        updateChainOfCustody(authenticationToken, chainOfCustodyUrl, entName, lastSyncTimeInMillis, callback) {
            dbconnectionManager.getConnection().collection('Settings').findOne({ type: 'applicationSettings' }, function (err, result) {
                if (err) {
                    logger.error(err);
                }

                if (result) {
                    if (!lastSyncTimeInMillis && result.chainOfCustidy) {
                        lastSyncTimeInMillis = result.chainOfCustidy.lastSyncTimeInMillis;
                    }
                    if (lastSyncTimeInMillis && result.chainOfCustidy && lastSyncTimeInMillis > result.chainOfCustidy.lastSyncTimeInMillis) {
                        lastSyncTimeInMillis = result.chainOfCustidy.lastSyncTimeInMillis;
                    }

                    result.chainOfCustidy = {
                        "authenticationToken": authenticationToken,
                        "lastSyncTimeInMillis": lastSyncTimeInMillis,
                        "chainOfCustodyUrl": chainOfCustodyUrl,
                        "enterpriseName": entName
                    }

                    let resultSet = dbconnectionManager.getConnection().collection('Settings').updateOne({}, {$set: result}).then(resultSet => {
                        if (resultSet.modifiedCount > 0) {
                            console.log("Settings updated successfully");
                            result.success = true;
                            if (callback) {
                                callback(result);
                            }
                        }
                    })
                    .catch((err) => {
                        console.error("Error occurred while updating Settings." + err);
                        if (callback) {
                            callback({ success: false });
                        }
                    });
                }
                else if (callback) {
                    callback({ success: false });
                }
            });
        }

        getLastestSyncedDate(callback) {
            let result = dbconnectionManager.getConnection().collection('Settings').findOne({type: 'applicationSettings'}).then((result) => {
                    if (result && result.chainOfCustidy) {
                        callback(null, result.chainOfCustidy.lastSyncTimeInMillis);
                    }
                })
                .catch((err) => {
                    console.error("Error occurred while fetching LastSyncedDate." + err);
                    callback(err, null);
                });
        }

        setLastSyncedDate(lastSyncedDateInMillis) {
            dbconnectionManager.getConnection().collection('Settings').findOne({ type: 'applicationSettings' }, function (err, result) {
                if (err) {
                    logger.error(err);
                }
                if(result) {
                    result.chainOfCustidy.lastSyncTimeInMillis = lastSyncedDateInMillis;
                    let resultSet = dbconnectionManager.getConnection().collection('Settings').updateOne({type: 'applicationSettings'}, {$set:result}).then((result) => {
                        if (resultSet.modifiedCount > 0) {
                            console.log("lastSyncedDateInMillis updated successfully ");
                        }
                    })
                    .catch((err) => {
                        console.error("Error occurred while updating LastSyncedDate." + err);
                    });
                }
			})
        }

        isInitialSyncDone(callback) {
            dbconnectionManager.getConnection().collection('Settings').findOne({type: 'applicationSettings'}).then((result) => {
                if (result && result.chainOfCustidy && result.chainOfCustidy.lastSyncTimeInMillis) {
                    callback(null, true);
                } else {
                    callback(null, false);
                }
            })
            .catch((err) => {
                console.error("Error occurred in isInitialSyncDone " + err);
                callback(err, false);
            });
        }
    }

export const syncTransactionTaskHelper = new SyncTransactionTaskHelper();
