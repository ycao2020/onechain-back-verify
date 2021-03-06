import {action} from 'mobx';
import {transactionHelper} from './TransactionHelper';
import {blockChainVerifier} from './BlockChainVerifier';
import {requestHelper} from './RequestHelper';
import {receiveTransactionsTask} from './ReceiveTransactionsTask';
import moment from 'moment';
import "isomorphic-fetch";
import config from './config';
import { observable } from 'mobx';
import oneBcClient from '@onenetwork/one-backchain-client';
import { dbconnectionManager } from './DBConnectionManager';
import { backChainUtil } from './BackChainUtil';
import {metaMaskHelper} from './MetaMaskHelper';
import { disputeHelper } from './DisputeHelper';
import { settingsHelper } from './SettingsHelper';
import React from 'react';

const MAX_EVENTS_TO_LOAD = 30;

let store;
export default class BackChainActions {

    static init(appStore, options) {
        store = appStore;

        if(options.getTransactionSliceByHash) {
            store.sliceDataProvidedByAPI = true;
            BackChainActions.getSliceDataFromAPI = options.getTransactionSliceByHash;
        }
        if(options.getOpenDisputeCount && options.getDisputes) {
            store.disputeDataProvidedByAPI = true;
            BackChainActions.getOpenDisputeCountFromAPI = options.getOpenDisputeCount;
            BackChainActions.loadDisputesFromAPI = options.getDisputes;
        }
    }

    @action
    static isInitialSyncDone() {
        fetch('/isInitialSyncDone', { method: 'GET'}).then(function(response) {
            return response.json();
        }, function(error) {
            console.error('error fetching initial sync');
        }).then(function(result) {
            if(result) {
                store.isInitialSyncDone = result.isInitialSyncDone;
                store.showDisputeActions = result.isInitialSyncDone;
            }
        })
    }


    /**
     * This method either loads provided array of transaction data, provided as the first argument,
     * or fetches transaction data and loads it into the store, if there are 2 provided arguments (id and searchCriteria).
     * @param {*} id - either a transaction or business id
     * @param {*} searchCriteria - either "tnxId" or "btId"
     */
    @action
    static loadTransactions(id, searchCriteria, callback) {
        store.transactions.clear();
        store.verifications.clear();
        store.canStartVerifying = false;

        if(arguments.length == 1 && Array.isArray(arguments[0])) {
            BackChainActions.loadTransactionsAux(arguments[0]);
            return;
        }

        let uri = null;
        if(searchCriteria == "tnxId") {
             uri = '/getTransactionById/' + id;
        }
        else if(searchCriteria == "btId") {
            uri = '/getTransactionByBusinessTransactionId/' + id;
        }

        store.loadingData = true;
		fetch(uri, {method: 'GET'}).then(function(response) {
			return response.json();
		}, function(error) {
            store.loadingData = false;
            store.error = "Couldn't load transactions. Please try again later";
  			console.error('error getting transaction by transaction id');
		}).then(function(result) {
            store.loadingData = false;
            if(result) {
                BackChainActions.loadTransactionsAux(result.result, callback);
            }
  		});
    }

    @action
    static loadTransactionsAux(transactions, callback) {
        transactions.forEach(element => {
            element.openDisputeCount = 0; //Start with 0 and fill them up.
            store.transactions.push(element);
            BackChainActions.getOpenDisputeCount(element.id)
            .then(function (result) {
                transactionHelper.assignOpenDisputCountInStore(store, element.id, result);
            })
            .catch(function (error) {
                console.error("Couldnt fetch open dispute count for transaction: " + element.id, error);
            });
        });
        transactionHelper.generateVerificationDataAndStartVerifying(transactions, store);
        if (callback) {
            callback(transactions.length > 0);
        }
    }

    @action
    static loadViewTransactionsById(type, partnerEntName, id) {
        store.myAndDiffViewModalType = type;
        for(let i = 0; i < store.transactions.length; i++) {
            let transaction = store.transactions[i];
            if(transaction.id != id) {
                continue;
            }

            const transactionSlices = transaction.transactionSlices;

            let initialValue = 0;
            let condition = idx => idx < transactionSlices.length;
            let action = idx => {
                let transactionSlice = transactionSlices[idx];

                // Always add the enterprise slice to the view.
                if(transactionSlice.type == "Enterprise") {
                    if(transactionSlice.payloadId) {
                        return BackChainActions.getTransactionSlice(transactionSlice.payloadId).then(result => {
                            let newJson = observable({});
                            newJson.id = id;
                            newJson.transactionSlice = JSON.parse(result.result);
                            store.viewTransactions.enterprise = newJson;
                        }).then(() => ++idx);
                    }
                    else if(store.sliceDataProvidedByAPI) {   // Slice comes from the API (for the Chain of Custody usecase)
                        return BackChainActions.getSliceDataFromAPI(id, transaction.transactionSliceHashes[idx], transactionSlice.sequence)
                          .then(serializedSlice => {
                              let newJson = observable({});
                              newJson.id = id;
                              newJson.transactionSlice = JSON.parse(serializedSlice);
                              store.viewTransactions.enterprise = newJson;
                          }).then(() => ++idx);
                    }
                    else {  // Comes from a payload
                        let newJson = observable({});
                        newJson.id = id;
                        newJson.transactionSlice = transactionSlice;
                        store.viewTransactions.enterprise = newJson;
                    }
                }

                let foundTheRightIntersection = false;
                if(type == "Intersection" && transactionSlice.type == "Intersection") {
                    if(partnerEntName.indexOf('&') > -1) {
                        let partners = partnerEntName.split('&');
                        if(transactionSlice.enterprises.indexOf(partners[0].trim()) > -1 &&
                            transactionSlice.enterprises.indexOf(partners[1].trim()) > -1) {
                            foundTheRightIntersection = true;
                        }
                    } else if(transactionSlice.enterprises.indexOf(partnerEntName) > -1) {
                        foundTheRightIntersection = true;
                    }
                }

                if(foundTheRightIntersection) {
                    if(transactionSlice.payloadId) {
                        return BackChainActions.getTransactionSlice(transactionSlice.payloadId).then(result => {
                            let newJson = observable({});
                            newJson.id = id;
                            newJson.transactionSlice = JSON.parse(result.result);
                            store.viewTransactions.intersection = newJson;
                        }).then(() => ++idx);
                    }
                    else if(store.sliceDataProvidedByAPI) {   // Slice comes form the API (for the Chain of Custody usecase)
                        return BackChainActions.getSliceDataFromAPI(id, transaction.transactionSliceHashes[idx], transactionSlice.sequence)
                          .then(serializedSlice => {
                              let newJson = observable({});
                              newJson.id = id;
                              newJson.transactionSlice = JSON.parse(serializedSlice);
                              store.viewTransactions.intersection = newJson;
                          }).then(() => ++idx);
                    }
                    else {  // Comes from a payload and won't have two slices to compare so always go with enterprise
                        store.myAndDiffViewModalType = "Enterprise";
                        let newJson = observable({});
                        newJson.id = id;
                        newJson.transactionSlice = transactionSlice;
                        store.viewTransactions.enterprise = newJson;
                    }
                }

                return new Promise(resolve => resolve(++idx));
            };

            return backChainUtil.promiseFor(condition, action, initialValue).then(() => {
                BackChainActions.setMyAndDiffViewActive(true);
            });
        }
    }

    @action
    static zipTransactionsByIds(type, partnerEntName, ids) {
        return new Promise(resolve => {
            store.payload.clear();
            let trvrsTnxInitVal = 0;
            let trvrsTnxCondition = trvrsTnxIdx => trvrsTnxIdx < store.transactions.length;
            let traverseTransactions = trvrsTnxIdx => {
                let transaction = store.transactions[trvrsTnxIdx];
                let trvrsIdInitVal = 0;
                let trvrsIdCondition = idx => idx < ids.length;
                let traverseIds = idx => {
                    if (transaction.id != ids[idx]) {
                        return new Promise(resolve => resolve(++idx));;
                    }
                    const id = transaction.id;
                    const date = transaction.date;
                    const transactionSlices = transaction.transactionSlices;
                    for (let j = 0; j < transactionSlices.length; j++) {
                        let transactionSlice = transactionSlices[j];
                        if(type == "Enterprise"
                            && transactionSlice.type == "Enterprise") {
                            if(transactionSlice.payloadId) {
                                return BackChainActions.getTransactionSlice(transactionSlice.payloadId).then(result => {
                                    let newJson = observable({});
                                    newJson.id = id;
                                    newJson.date = date;
                                    newJson.merklePath = transactionSlice.merklePath;
                                    newJson.transactionSlice = result.result;
                                    store.payload.push(newJson);
                                }).then(() => ++idx);
                            }
                            else if(store.sliceDataProvidedByAPI) {   // Slice comes from the API (for the Chain of Custody usecase)
                                return BackChainActions.getSliceDataFromAPI(id, transaction.transactionSliceHashes[j], transactionSlice.sequence)
                                  .then(serializedSlice => {
                                      let newJson = observable({});
                                      newJson.id = id;
                                      newJson.date = date;
                                      newJson.merklePath = transactionSlice.merklePath;
                                      newJson.transactionSlice = serializedSlice;
                                      store.payload.push(newJson);
                                  }).then(() => ++idx);
                            }
                            else {  // Comes from a payload
                                let newJson = observable({});
                                newJson.id = id;
                                newJson.date = date;
                                newJson.merklePath = transactionSlice.merklePath;
                                newJson.transactionSlice = transaction.transactionSlicesSerialized[j];
                                store.payload.push(newJson);
                            }
                        }

                        if(type == "Intersection" && transactionSlice.type == "Intersection"
                            && transactionSlice.enterprises.indexOf(partnerEntName) > -1) {
                            if(transactionSlice.payloadId) {
                                return BackChainActions.getTransactionSlice(transactionSlice.payloadId).then(result => {
                                    let newJson = observable({});
                                    newJson.id = id;
                                    newJson.date = date;
                                    newJson.merklePath = transactionSlice.merklePath;
                                    newJson.transactionSlice = result.result;
                                    store.payload.push(newJson);
                                }).then(() => ++idx);
                            }
                            else if(store.sliceDataProvidedByAPI) {   // Slice comes from the API (for the Chain of Custody usecase)
                                return BackChainActions.getSliceDataFromAPI(id, transaction.transactionSliceHashes[j], transactionSlice.sequence)
                                  .then(serializedSlice => {
                                      let newJson = observable({});
                                      newJson.id = id;
                                      newJson.date = date;
                                      newJson.merklePath = transactionSlice.merklePath;
                                      newJson.transactionSlice = serializedSlice;
                                      store.payload.push(newJson);
                                  }).then(() => ++idx);
                            }
                            else {  // Comes from a payload
                                let newJson = observable({});
                                newJson.id = id;
                                newJson.date = date;
                                newJson.merklePath = transactionSlice.merklePath;
                                newJson.transactionSlice = transaction.transactionSlicesSerialized[j] ;
                                store.payload.push(newJson);
                            }
                        }
                    }
                    return new Promise(resolve => resolve(++idx));
                }
                return backChainUtil.promiseFor(trvrsIdCondition, traverseIds, trvrsIdInitVal).then(() => ++trvrsTnxIdx);
            }
            return backChainUtil.promiseFor(trvrsTnxCondition, traverseTransactions, trvrsTnxInitVal).then(resolve);
        });
    }

    @action
    static saveBlockChainSettings(url, contractAddress, disputeContractAddress, disputeSubmissionWindowInMinutes, providerType, hyperLedgerToken) {
        let params = {
            'url':url,
            'contractAddress': contractAddress,
            'disputeContractAddress': disputeContractAddress,
            'disputeSubmissionWindowInMinutes': disputeSubmissionWindowInMinutes,
            'providerType': providerType,
            'hyperLedgerToken': hyperLedgerToken
        };
        fetch('/saveBlockChainSettings', {
            method: 'post',
            headers: new Headers({
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Content-Type': 'application/x-www-form-urlencoded',
            }),
            body: requestHelper.jsonToUrlParams(params)
          }).then(function(response) {
            return response.json();
          }).then(function(result) {
            if(result.success === true){
                store.isInitialSetupDone = true;
            }else{
                store.isInitialSetupDone = false;
            }
        })
        .catch(function (err) {
            console.error('Error saving configuration to database!');
            store.isInitialSetupDone = false;
            store.blockChainUrl = null;
            store.blockChainContractAddress = null;
            store.hyperLedgerToken = null;
            store.disputeBlockChainContractAddress = null;
        });
    }

    @action
    static setMyAndDiffViewActive(active) {
        store.myAndDiffViewModalActive = active;
    }

    @action
    static toggleDisplayMessageView() {
        store.displayMessageViewModalActive = !store.displayMessageViewModalActive;
    }

    @action
    static toggleDBSyncModalViewActive() {
        store.dbSyncModalViewActive = !store.dbSyncModalViewActive;
    }

    @action
    static toggleNewDisputeModalView() {
        store.newDisputeModalActive = !store.newDisputeModalActive;
    }

    @action
    static closeAlertPopup() {
        store.displayAlertPopup = false;
    }

    @action
    static processApplicationSettings() {
        /**
         * If the value is null, it means db was never checked for the value.
         * If it's not null, there's no need to go to the db anymore.
         * User have to go to /setup page and enter credentials to set it to true(@saveBlockChainSettings),
         * otherwise it will stay as false.
         */
        return new Promise(function(resolve, reject) {
            if(store.isInitialSetupDone == null) {
                fetch('/getApplicationSettings', { method: 'GET'}).then(function(response) {
                    return response.json();
                }).then(function(result) {
                    let isInitialSetupSaved = false;
                    let blockChainSettings = result.success ? result.settings.blockChain : null;

                    if(blockChainSettings && blockChainSettings.url) {
                        /*submissionWindow can return as 0 if PLT hasn't submitted a value 0 is considered as false*/
                        if(blockChainSettings.providerType === BC_TECH_ENUM.ethereum && blockChainSettings.contractAddress && blockChainSettings.disputeContractAddress && typeof blockChainSettings.disputeSubmissionWindowInMinutes != 'undefined') {
                            isInitialSetupSaved = true;
                        } else if(blockChainSettings.providerType === BC_TECH_ENUM.hyperledger && blockChainSettings.hyperLedgerToken) {
                            isInitialSetupSaved = true;
                        }
                    }
                    
                    if (isInitialSetupSaved) {
                        store.isInitialSetupDone = true;
                        store.blockChainUrl = result.settings.blockChain.url;
                        store.blockChainContractAddress = result.settings.blockChain.contractAddress;
                        store.hyperLedgerToken = result.settings.blockChain.hyperLedgerToken;
                        store.disputeBlockChainContractAddress = result.settings.blockChain.disputeContractAddress;
                        store.disputeSubmissionWindowInMinutes = result.settings.blockChain.disputeSubmissionWindowInMinutes;
                        store.providerType = result.settings.blockChain.providerType;
                    } else {
                        store.isInitialSetupDone = false;
                        store.blockChainUrl = config.blockChainUrl;
                        store.blockChainContractAddress = config.blockChainContractAddress;
                        store.disputeBlockChainContractAddress = config.disputeBlockChainContractAddress;
                        store.disputeSubmissionWindowInMinutes = 24 * 60; //Default value is one day in minutes.
                    }
                    if(result.success && result.settings.chainOfCustidy &&
                        result.settings.chainOfCustidy.authenticationToken) {
                        store.authenticationToken = result.settings.chainOfCustidy.authenticationToken;
                        store.chainOfCustodyUrl = result.settings.chainOfCustidy.chainOfCustodyUrl;
                        store.entNameOfLoggedUser = result.settings.chainOfCustidy.enterpriseName;
                      } else {
                          store.authenticationToken = null;
                          store.chainOfCustodyUrl=config.chainOfCustodyUrl;
                    }
                    store.mode = result.success ? result.settings.mode : 'dev';
                    resolve(true);
                }).catch(function(error) {
                    store.isInitialSetupDone = null;
                    store.authenticationToken = null;
                    store.disputeSubmissionWindowInMinutes = null;
                    store.mode = 'dev';
                    reject(error);
                });
            } else {
                resolve(true);
            }
        });
    }

    @action
    static mergeUploadedPayloadWithDb(payloads, callback) {
        let transArr = [];
        let payloadLength = payloads.length;
        let i = 1;
        payloads.forEach(payload => {
            this.findTransaction(payload.id, function(transactions) {
                let payloadHash = blockChainVerifier.generateHash(payload.transactionSlice);
                if (transactions.length > 0) {
                    let transaction = transactions[0];
                    transaction.transactionSlicesSerialized = [];
                    let index = transactionHelper.findSliceInTransaction(transaction, payload.transactionSlice);
                    let deSerializedPayloadSlice = JSON.parse(payload.transactionSlice);
                    deSerializedPayloadSlice.merklePath = payload.merklePath;
                    if (index >= 0) {
                        transaction.transactionSlices[index] = deSerializedPayloadSlice;
                        transaction.transactionSlicesSerialized[index] = payload.transactionSlice;
                        transaction.trueTransactionSliceHashes[index] = payloadHash;
                    } else {
                        transaction.transactionSlices.push(deSerializedPayloadSlice);
                        transaction.transactionSlicesSerialized.push(payload.transactionSlice);
                        transaction.trueTransactionSliceHashes.push(payloadHash);
                        transaction.transactionSliceHashes.push(payloadHash);
                    }
                    transArr.push(transaction);
                } else {
                    const sliceObject = JSON.parse(payload.transactionSlice);
                    sliceObject.merklePath = payload.merklePath;
                    transArr.push({
                        id: payload.id,
                        date: payload.date,
                        transactionSlices: [sliceObject],
                        transactionSlicesSerialized: [payload.transactionSlice], //helper field to be used in download
                        eventCount: transactionHelper.getEventCount(sliceObject),
                        executingUsers: transactionHelper.addExecutingUsers([], sliceObject),
                        trueTransactionSliceHashes: [payloadHash],
                        transactionSliceHashes : [payloadHash]
                    });
                }

                if (i == payloadLength && transArr.length > 0) {
                    store.transactions.clear();
                    store.verifications.clear();
                    store.canStartVerifying = false;
                    transArr.forEach(element => {
                        element.openDisputeCount = 0; //Start with 0 and fill them up.
                        store.transactions.push(element);
                        BackChainActions.getOpenDisputeCount(element.id)
                        .then(function (result) {
                            transactionHelper.assignOpenDisputCountInStore(store, element.id, result);
                        })
                        .catch(function (error) {
                            console.error("Couldnt fetch open dispute count for transaction: " + element.id, error);
                        });
                    });
                    transactionHelper.generateVerificationDataAndStartVerifying(transArr, store);
                    callback();
                }
                i++;
            })
        })
    }

    @action
    static findTransaction(transId, callback) {
        let uri = '/getTransactionById/' + transId;
        fetch(uri, {
            method: 'GET'
        }).then(function(response) {
            return response.json();
        }, function(error) {
            console.error('error getting transaction by transaction id in mergeUploadedPayloadWithDb');
        }).then(function(result) {
            if (result.result[0] != false) {
                callback(result.result);
            } else {
                callback(null);
            }
        })
    }

    @action
    static startSyncFromCertainDate(authenticationToken, startFromDate, chainOfCustodyUrl) {
        let params = {
            'authenticationToken': authenticationToken,
            'startFromDate': startFromDate,
            'chainOfCustodyUrl': chainOfCustodyUrl,
            'offset': new Date().getTimezoneOffset()
        };
        fetch('/startSyncFromCertainDate', {
            method: 'post',
            headers: new Headers({
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Content-Type': 'application/x-www-form-urlencoded',
            }),
            body: requestHelper.jsonToUrlParams(params)
        })
        .then(function(response) {
            return response.json();
        })
        .then(function (result) {
            if(result.success) {
                store.authenticationToken = result.chainOfCustidy.authenticationToken;
                store.chainOfCustodyUrl = result.chainOfCustidy.chainOfCustodyUrl;
                store.entNameOfLoggedUser = result.chainOfCustidy.enterpriseName;
                store.earliestResetDateInMillis = result.earliestResetDateInMillis;
                store.isInitialSyncDone = true;
                store.showDisputeActions = true;
                BackChainActions.setSyncInitiated(true);
                BackChainActions.displayAlertPopup('Started Synchronization', "Synchronization with One Network's Audit Repository App has succesfully been started."
                + " This operation may take a while to complete. Please refresh Sync Statisctics page to monitor the process.", 'SUCCESS');
            } else {
                BackChainActions.setSyncInitiated(false);
                BackChainActions.displayAlertPopup("Couldn't Start Synchronization", "Synchronization with One Network's Audit Repository App couldn't have been started."
                + " Please try again and inform administrator about the issue if it continues.", 'ERROR');
            }
        })
        .catch(function (err) {
            BackChainActions.setSyncInitiated(false);
            console.error('Error communicating with PLT: ' + err);
            BackChainActions.displayAlertPopup("Couldn't Start Synchronization", "Synchronization with One Network's Audit Repository App couldn't have been started."
                + " Please try again and inform administrator about the issue if it continues.", 'ERROR');
        });
    }

    @action
    static startGapSync(authenticationToken, chainOfCustodyUrl, gaps) {
        if(gaps == null || gaps.length == 0) {
            return;
        }
        let params = {
            'authenticationToken': authenticationToken,
            'gaps': gaps,
            'chainOfCustodyUrl' : chainOfCustodyUrl
        };
        fetch('/startGapSync', {
            method: 'post',
            headers: new Headers({
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Content-Type': 'application/x-www-form-urlencoded',
            }),
            body: requestHelper.jsonToUrlParams(params)
        })
        .then(function(response) {
            return response.json();
        })
        .then(function (result) {
            if(result.success) {
                store.authenticationToken = result.authenticationToken;
                store.chainOfCustodyUrl = result.chainOfCustodyUrl;
                store.isInitialSyncDone = true;
                store.showDisputeActions = true;
                BackChainActions.displayAlertPopup('Started Synchronization', "Synchronization with One Network's Audit Repository App has succesfully been started."
                + " Selected gaps will be filled once the operation has been completed. This operation may take a while. Please refresh Sync Statisctics page to monitor the process.", 'SUCCESS');
            } else {
                store.startSync = false;
                BackChainActions.displayAlertPopup("Couldn't Start Synchronization", "Synchronization with One Network's Audit Repository App couldn't have been started."
                + " Please try again and inform administrator about the issue if it continues.", 'ERROR');
            }
        })
        .catch(function (err) {
            store.startSync = false;
            console.error('Error communicating with PLT: ' + err);
            BackChainActions.displayAlertPopup("Couldn't Start Synchronization", "Synchronization with One Network's Audit Repository App couldn't have been started."
                + " Please try again and inform administrator about the issue if it continues.", 'ERROR');
        });
    }


    @action
    static verifyBackChainSettings() {
        //Verify orchestrator first and then getDisputeSubmissionWindows to make sure required things work.
        try {
            let contentBcClient = oneBcClient.createContentBcClient({
                blockchain: store.providerType,
                url: store.blockChainUrl,
                contentBackchainContractAddress: store.blockChainContractAddress,
                disputeBackchainContractAddress: store.disputeBlockChainContractAddress,
                token: store.hyperLedgerToken
            });
            
            contentBcClient.getOrchestrator()
            .then(function (result) {
                if(store.providerType === 'eth') {
                    //Content BackChain credentials are correct and the connection is established. Try it for disputeContentBackChain
                    let disputeBcClient = oneBcClient.createDisputeBcClient({
                        blockchain: store.providerType,
                        url: store.blockChainUrl,
                        contentBackchainContractAddress: store.blockChainContractAddress,
                        disputeBackchainContractAddress: store.disputeBlockChainContractAddress
                    });

                    disputeBcClient.getDisputeSubmissionWindowInMinutes().
                    then(function(result){
                        store.disputeSubmissionWindowInMinutes = parseInt(result);
                        BackChainActions.saveBlockChainSettings(store.blockChainUrl, store.blockChainContractAddress, store.disputeBlockChainContractAddress, store.disputeSubmissionWindowInMinutes, store.providerType, null);
                    }).
                    catch(function(error) {
                        BackChainActions.displayAlertPopup("Dispute BackChain Communication Failed", "Could not connect to the dispute backchain, please check dispute backchain contract address and try again.",'ERROR');
                        console.error(error);
                    });
                } else {
                    BackChainActions.saveBlockChainSettings(store.blockChainUrl, null, null, null, store.providerType, store.hyperLedgerToken);
                }
            })
            .catch(function (error) {
                BackChainActions.displayAlertPopup("Content BackChain Communication Failed", "Could not connect to the content backchain, please check your settings and try again.",'ERROR');
                console.error(error);
            });
        } catch(error) {
            BackChainActions.displayAlertPopup("BackChain Communication Failed", "Could not connect to the backchain, please check your settings and try again.",'ERROR');
            console.error(error);
        }
    }

    @action
    static displayAlertPopup(title, message, level) {
        BackChainActions.closeAlertPopup();
        store.alertPopupLevel = level;
        store.alertPopupTitle = title;
        store.alertPopupContent = message;
        store.displayAlertPopup = true;
    }

    @action
    static getSyncStatisticsInfo(generateReportForUI) {
        fetch('/getSyncStatisticsInfo', {method: 'GET'})
        .then(function(response) {
            return response.json();
        })
        .then(function(result) {
            if(result.success) {
                store.syncStatistics = result.syncStatisticsInfo.syncStatistics;
                store.earliestResetDateInMillis = result.syncStatisticsInfo.syncStatistics.earliestResetDateInMillis
                store.syncStatisticsExists = result.syncStatisticsInfo.syncStatisticsExists;                  
            }
            if(generateReportForUI) {
                settingsHelper.prepareStatisticsReportDataForUI(store);
            }
        })
        .catch(function (err) {
            console.log('Couldnt fetch SyncStatistics Info. error: ' + err);
        });     
    }

    @action
    static populateStoreWithApplicationSettings() {
        fetch('/getApplicationSettings', {method: 'GET'})
        .then(function(response) {
            return response.json();
        })
        .then(function(result) {
            if(result.success) {
                store.authenticationToken = result.settings.chainOfCustidy.authenticationToken;
                store.chainOfCustodyUrl = result.settings.chainOfCustidy.chainOfCustodyUrl;
                store.entNameOfLoggedUser = result.settings.chainOfCustidy.enterpriseName;
                //Add more when needed
            }
        })
        .catch(function (err) {
            console.log('Error occured while populating application settings');
        });
    }

    @action
    static getTransactionsBySequenceNos(sequenceNoArr, callback) {
        fetch('/getTransactionsBySequenceNos/' + JSON.stringify(sequenceNoArr), { method: 'GET'})
        .then(function(response) {
            return response.json();
        })
        .then(function(result) {
            if(result.success) {
                callback(null, result.txns);
            }
        })
        .catch(function (err) {
            callback(err, null);
            console.log('Gap Sync Initiation failed.');
        });
    }

    @action
    static loadEventsForTransaction(transaction) {
        if(store.eventsTransactionId === transaction.id) {
            return;
        }

        if(store.sliceDataProvidedByAPI) {
            for(let i = 0; i < transaction.transactionSlices.length; i++) {
                let transactionSlice = transaction.transactionSlices[i];
                if(transactionSlice.type == 'Enterprise') {
                    BackChainActions.getSliceDataFromAPI(transaction.id, transaction.transactionSliceHashes[i], transactionSlice.sequence)
                        .then(action(serializedSlice => {
                            let sliceData = JSON.parse(serializedSlice);
                            let events = transactionHelper.extractEventsFromSlice(sliceData);

                            if(sliceData.businessTransactions.length > MAX_EVENTS_TO_LOAD) {
                                events.push(sliceData.businessTransactions.length - MAX_EVENTS_TO_LOAD);
                            }

                            store.eventsTransactionId = transaction.id;
                            store.events = events;
                        }));
                    return;
                }
            }

            console.log('Warning: Slice with type "Enterprise" not found in the transaction.');
            return;
        }

        let uri = '/getEventsForTransaction/' + transaction.id;
        fetch(uri, { method: 'GET' }).then(function(response) {
            return response.json();
        }, function(error) {
            console.error(error);
        }).then(action(function(json) {
            store.eventsTransactionId = transaction.id;
            if(json.result.length == 0) {
                //Transaction doesn't exist in db, so find events within the payload.
                store.events = transactionHelper.extractEventsFromSlice(transaction.transactionSlices[0])
            } else {
                store.events = json.result;
            }
        }));
    }

    @action
    static getTransactionSlice(payloadId) {
        let uri = '/getTransactionSlice/' + payloadId;
        return fetch(uri, { method: 'GET' }).then(function(response) {
            return response.json();
        }, function(error) {
            console.error(error);
        })
    }

    @action
    static loadDisputes(filters) {
        store.disputes.clear();
        store.loadingData = true;
        //Handle filters properly while fetching either from mongoDb or blockChain(through onechainbackclient)
        const loadDisputesPromise = store.disputeDataProvidedByAPI
            ? BackChainActions.loadDisputesFromAPI(filters)
            : fetch('/getDisputes', {
                method: 'post',
                headers: new Headers({
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Content-Type': 'application/x-www-form-urlencoded',
                }),
                body: requestHelper.jsonToUrlParams(filters)
            }).then(response => response.json());

        loadDisputesPromise.then(result => {
            store.loadingData = false;
            if (result && result.success) {
                (result.disputes || []).forEach(dispute => {
                    store.disputes.push(dispute);
                });
                disputeHelper.sortDisputesByAscOrderBasedOnTnxDate(store.disputes);
                disputeHelper.orderDisputes(store.disputes);
            } else {
                store.error = "Couldn't load disputes. Please try again later";
                console.error('error getting disputes');
            }
        }).catch(error => {
            store.loadingData = false;
            store.error = "Couldn't load disputes. Please try again later";
            console.error('error getting disputes');
        });
    }

    @action
    static getOpenDisputeCount(transactionId, disputingPartyAddress) {
        const getOpenDisputeCountPromise = store.disputeDataProvidedByAPI
            ? BackChainActions.getOpenDisputeCountFromAPI(transactionId)
            : fetch('/getOpenDisputeCount', {
                method: 'post',
                headers: new Headers({
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Content-Type': 'application/x-www-form-urlencoded',
                }),
                body: requestHelper.jsonToUrlParams({
                    "transactionId": transactionId,
                    "disputingPartyAddress": disputingPartyAddress
                })
            }).then(response => response.json());

        return new Promise(resolve => {
            getOpenDisputeCountPromise.then(result => {
                if (result && result.success) {
                    store.openDisputeCountOfLoggedUser = result.disputeCount;
                    resolve(result.disputeCount);
                } else {
                    console.error('error getting dispute count');
                    resolve(0);
                }
            }).catch(error => {
                console.error('error getting dispute count');
                console.log(error);
            });
        });
    }

    @action
    static populateDisputeTransaction(transactionId) {
        store.disputeTransaction = null;
        return new Promise(function(resolve, reject) {
            let disputeTnxExistsInStore = false;
            for(let i = 0; i < store.transactions.length; i++) {
                let transaction = store.transactions[i];
                if(transaction.id === transactionId) {
                    store.disputeTransaction = transaction;
                    disputeTnxExistsInStore = true;
                    break;
                }
            }
            if(disputeTnxExistsInStore) {
                resolve(true);
            } else {
                let uri = '/getTransactionById/' + transactionId;
                fetch(uri, {method: 'GET'}).then(function(response) {
                    return response.json();
                }, function(error) {
                    console.error('error getting transaction by transaction id for populateDisputeTransaction');
                    reject("Transaction ID: " + transactionId + " could not be found. Please enter a valid transaction ID.");
                }).then(function(result) {
                    if(result.result.length > 0) {
                        store.disputeTransaction = result.result[0];
                        resolve(true);
                    } else {
                        reject("Transaction ID: " + transactionId + " could not be found. Please enter a valid transaction ID.");
                    }
                });
            }
        })
    }

    @action
    static clearDisputeIdAndTransaction() {
        store.disputeTransaction = null;
        store.generatedDisputeId = null;
    }

    @action
    static saveDisputeAsDraft(dispute) {
        return new Promise(resolve => {
            let uri = '/saveDisputeAsDraft/' + JSON.stringify(dispute);
-           fetch(uri, { method: 'GET' })
            .then(function(response) {
                return response.json();
            }, function(error) {
                console.error(error);
            }).then(function(response) {
                if(response.success) {
                    dispute.transaction = store.disputeTransaction;
                    store.disputes.unshift(dispute);
                    disputeHelper.sortDisputesByAscOrderBasedOnTnxDate(store.disputes);
                    disputeHelper.orderDisputes(store.disputes);
                }
                resolve(response);
            })
        })
    }

    @action
    static discardDisputeDraft(disputeId, removeFromStore) {
        return new Promise(function(resolve, reject) {
            let uri = '/discardDraftDispute/' + disputeId;
            return fetch(uri, { method: 'POST' })
                .then(function (response) {
                    return response.json();
                }, function (error) {
                    console.error(error);
                    reject();
                }).then(function (result) {
                    if (result.success) {
						if(removeFromStore) {
							let currentDisputes = store.disputes;
							for (let i = 0; currentDisputes && i < currentDisputes.length; i++) {
								if (disputeId == currentDisputes[i].disputeId) {
									currentDisputes.splice(i, 1);
									break;
								}
							}
							store.disputes = currentDisputes;
                        }
                        resolve(true)
                    } else {
                        console.error('error while discarding dispute draft.');
                        reject();
                    }
                })
        })
    }

    @action
    static closeDispute(dispute) {
        store.metamaskPopupViewActive = true;
        metaMaskHelper.detectAndReadMetaMaskAccount().then((accountNumber) => {
            let disputeBcClient = oneBcClient.createDisputeBcClient({
                blockchain: 'eth',
                web3Provider: web3.currentProvider,
                fromAddress: accountNumber,
                contentBackchainContractAddress: store.blockChainContractAddress,
                disputeBackchainContractAddress: store.disputeBlockChainContractAddress
            });
            disputeBcClient.closeDispute(dispute.disputeId)
                .then(function (receipt) {
                    store.metamaskPopupViewActive = false;
                    if (receipt && receipt.blockNumber) {
                        BackChainActions.registerAddress(accountNumber);
                        BackChainActions.updateDisputeState(dispute.disputeId, 'CLOSED');
                        BackChainActions.displayAlertPopup('Dispute closed Successfully', "Dispute closed Successfully", "SUCCESS");
                    } else {
                        BackChainActions.displayAlertPopup("Close Dispute Failed",
                            "Close Dispute failed at the BlockChain. Please contact One Network if the problem persists.", "ERROR");
                    }
                }).
                catch(function (error) {
                    store.metamaskPopupViewActive = false;
                    if (error) {
                        if(error.message && error.message.indexOf('User denied transaction signature') > -1) {
                            BackChainActions.displayAlertPopup("MetaMask Transaction was Denied",
                            ["You have to approve the transaction in metamask in order to close the Dispute. Please close again and approve the transaction."],'ERROR');
                        }
                        else if(error.message && error.message.indexOf('Be aware that it might still be mined!') > -1) {
                            BackChainActions.displayAlertPopup("Did Not Receive Confirmation",
                            ["We did not receive a Transaction Confirmation from the blockchain within the expected timeout threshold.  Your Dispute may or may not have been closed in the blockchain. Please wait 1-2 minutes and refresh the Disputes page.  If your Dispute remains unclosed, try re-submitting the Close operation with a higher Gas Price."],'WARN');
                        }
                        else {
                            BackChainActions.displayAlertPopup("Close Dispute Failed",
                            ["Closed Dispute failed. These could be of various reasons. Please control your metamask connection and try again."],'ERROR');
                        }
                        console.error(error);
                    }
                });
        }).catch((error) => {
            store.metamaskPopupViewActive = false;
            if (error.code == 'error.metamask.missing') {
                let metaMaskExtensionURL = 'https://chrome.google.com/webstore/detail/nkbihfbeogaeaoehlefnkodbefgpgknn';
                if (navigator.userAgent.indexOf("Firefox") != -1) {
                    metaMaskExtensionURL = 'https://addons.mozilla.org/en-US/firefox/addon/ether-metamask/';
                }
                BackChainActions.displayAlertPopup("Missing MetaTask Extension",
                    ["You need to install ", <a key="error.metamask.missing" href={metaMaskExtensionURL} target='_blank'>MetaMask</a>,
                        " in order to use Submit or Close Disputes. Please install the extension, refresh your browser and try again."], 'ERROR');
            } else if (error.code == 'error.metamask.locked') {
                BackChainActions.displayAlertPopup("MetaMask is Locked",
                    ["Metamask plugin is currently locked. Please unlock the plugin, connect to the proper node with the right account and try later"], 'ERROR');
            } else if (error.code == 'error.metamask.nosupport') { 
                BackChainActions.displayAlertPopup("Metamask Not Supported",
                    ["The browser you use doesn't support MetaMask extension. Metamask is required in order to submit and close disputes. Please use Chrome or Firefox and install metamask plugin in order to enable this functioanlity "], 'ERROR');
            } else {
                BackChainActions.displayAlertPopup("Problem Occured",
                    ["Please make sure that MetaMask plugin is installed and properly configured with the right url and account."], 'ERROR');
            }
            console.error(error);
        });
    }

    @action
    static submitDispute(dispute, draftExists) {
        store.metamaskPopupViewActive = true;
        metaMaskHelper.detectAndReadMetaMaskAccount().then((accountNumber)=>{
            let disputeBcClient = oneBcClient.createDisputeBcClient({
                blockchain: 'eth',
                web3Provider : web3.currentProvider,
                fromAddress: accountNumber,
                contentBackchainContractAddress: store.blockChainContractAddress,
                disputeBackchainContractAddress: store.disputeBlockChainContractAddress
            });
            disputeBcClient.submitDispute(dispute)
            .then(function(receipt){
                store.metamaskPopupViewActive = false;
                if(receipt && receipt.blockNumber) {
                    BackChainActions.registerAddress(accountNumber);
                    dispute.disputingParty = accountNumber;
                    if(draftExists) {
                        BackChainActions.discardDisputeDraft(dispute.disputeId, false);
                    } else {
                        store.disputes.unshift(dispute);  
                        BackChainActions.clearDisputeIdAndTransaction(); //Needed for NewDispute Window but doesn't hurt to have in general
                    }                                          
                    BackChainActions.updateDisputeState(dispute.disputeId, 'OPEN');                
                    BackChainActions.displayAlertPopup('Dispute Submitted Successfully', "Your Dispute Submission is Successful", "SUCCESS");
                } else {
                    BackChainActions.displayAlertPopup("Dispute Submission Failed",
                    "Dispute submission failed at the BlockChain. Please contact One Network if the problem persists.", "ERROR");
                }
            }).
            catch(function(error) {
                store.metamaskPopupViewActive = false;
                if (error) {
                    if(error.message && error.message.indexOf('User denied transaction signature') > -1) {
                        BackChainActions.displayAlertPopup("MetaMask Transaction was Denied",
                        ["You have to approve the transaction in metamask in order to submit the Dispute. Please submit again and approve the transaction."],'ERROR');
                    } 
                    else if(error.message && error.message.indexOf('Be aware that it might still be mined!') > -1) {
                        BackChainActions.displayAlertPopup("Did Not Receive Confirmation",
                        ["We did not receive a Transaction Confirmation from the blockchain within the expected timeout threshold.  Your Dispute may or may not be committed to the blockchain. Please wait 1-2 minutes and refresh the Disputes page.  If you do not see your Dispute, try re-submitting the dispute with a higher Gas Price."],'WARN');
                    }
                    else {
                        BackChainActions.displayAlertPopup("Dispute Submission Failed",
                        ["Dispute Submission failed. These could be of various reasons. Please control your metamask connection and try again."],'ERROR');
                    }
                    console.error(error);
                }
            });
        }).catch((error)=> {
            store.metamaskPopupViewActive = false;
            if(error.code == 'error.metamask.missing') {
                let metaMaskExtensionURL = 'https://chrome.google.com/webstore/detail/nkbihfbeogaeaoehlefnkodbefgpgknn';
                if (navigator.userAgent.indexOf("Firefox") != -1) {
                    metaMaskExtensionURL = 'https://addons.mozilla.org/en-US/firefox/addon/ether-metamask/';
                }
                BackChainActions.displayAlertPopup("Missing MetaTask Extension",
                    ["You need to install ", <a key="error.metamask.missing" href={metaMaskExtensionURL} target='_blank'>MetaMask</a>,
                    " in order to use Submit or Close Disputes. Please install the extension, refresh your browser and try again."],'ERROR');
            } else if(error.code == 'error.metamask.locked') {
                BackChainActions.displayAlertPopup("MetaMask is Locked",
                ["Metamask plugin is currently locked. Please unlock the plugin, connect to the proper node with the right account and try later"],'ERROR');
            } else if (error.code == 'error.metamask.nosupport') {
                BackChainActions.displayAlertPopup("Metamask Not Supported",
                    ["The browser you use doesn't support MetaMask extension. Metamask is required in order to submit and close disputes. Please use Chrome or Firefox and install metamask plugin in order to enable this functioanlity "], 'ERROR');
            } else {
                BackChainActions.displayAlertPopup("Problem Occured",
                ["Please make sure that MetaMask plugin is installed and properly configured with the right url and account."],'ERROR');
            }
        });
    }

    @action
    static generateDisputeId(plainText) {
        store.generatedDisputeId = null;
        let uri = '/generateDisputeId/' + plainText;
        return fetch(uri, { method: 'GET' })
        .then(function(response) {
            return response.json();
        }, function(error) {
            console.error(error);
        }).then(function(response){
            if(response.success) {
                store.generatedDisputeId = response.generatedDisputeId;
            }
        });
    }

    /**
     * Pass backChainAccountOfLoggedUser which we get from metamask.
     * And register it to to PLT instance.
     * @param {*} backChainAccountOfLoggedUser
     */
    @action
    static registerAddress(backChainAccountOfLoggedUser) {
        if(store.backChainAccountOfLoggedUser == backChainAccountOfLoggedUser) {
            return;
        }
        let params = {
            'authenticationToken': store.authenticationToken,
            'chainOfCustodyUrl': store.chainOfCustodyUrl,
            'backChainAccountOfLoggedUser':backChainAccountOfLoggedUser
        };
        fetch('/registerAddress', {
            method: 'post',
            headers: new Headers({
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Content-Type': 'application/x-www-form-urlencoded',
            }),
            body: requestHelper.jsonToUrlParams(params)
        })
        .then(function(response) {
            return response.json();
        }, function(error) {
            console.error(error);
        }).then(function(response) {
            if(response.success)
                store.backChainAccountOfLoggedUser = backChainAccountOfLoggedUser;
        })
    }

    @action
    static updateDisputeState(disputeId, newState) {
        let currentDisputes = store.disputes;
        for (let i = 0; currentDisputes && i < currentDisputes.length; i++) {
            if (disputeId == currentDisputes[i].disputeId) {
                if("OPEN" == newState) {
                    currentDisputes[i].submittedDate = new Date().getTime();
                } else if("CLOSED" == newState) {
                    currentDisputes[i].closedDate = new Date().getTime(); //It's okay to set the current time because that's what block chain will set
                }
                currentDisputes[i].state = newState;
                break;
            }
        }
        disputeHelper.sortDisputesByAscOrderBasedOnTnxDate(currentDisputes);
        disputeHelper.orderDisputes(currentDisputes);
    }

    /**
     * This function reads mapping from the DB and and add the value to store.
     */
    @action
    static readBackChainAddressMapping() {
        return new Promise(function(resolve, reject) {
            let uri = '/readBackChainAddressMapping';
            fetch(uri, {
                method: 'GET'
            }).then(function(response) {
                return response.json();
            }, function(error) {
                reject(error);
            }).then(function(result) {
                if(result.success) {
                    store.backChainAddressMapping = result.backChainAddressMapping;
                    resolve(true);
                } else {
                    reject('error reading BackChainAddressMapping');
                }
            })
        });
    }

    @action
    static setPreSetDisputeFilters(preSetDisputeFilters) {
        store.preSetDisputeFilters = preSetDisputeFilters;
    }

    @action
    static verifyDocumentHashes(attachments) {
        let params = {
            'attachments': attachments
        };
        fetch('/verifyDocumentHashes', {
            method: 'post',
            headers: new Headers({
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Content-Type': 'application/x-www-form-urlencoded',
            }),
            body: requestHelper.jsonToUrlParams(params)
        }).then(function(response) {
            return response.json();
        }).then(function(result) {
            if(result.success) {
                store.attachmentVerificationMap = result.attachmentVerificationMap;
            }
        }).catch(function (err) {
            console.error('error verifying attachements!');
        });
    }

    @action
    static setSyncInitiated(value) {
        store.syncInitiated = value;
    }

}
export const BC_TECH_ENUM=Object.freeze({"ethereum":"eth", "hyperledger":"hyp"});
