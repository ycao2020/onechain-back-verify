/*
 Configure all routings here
*/
import BackChainWebAPI from './BackChainWebAPI';

export function router(app) {
    app.get('/isInitialSyncDone', BackChainWebAPI.isInitialSyncDone);
    app.get('/getTransactionById/:transId', BackChainWebAPI.getTransactionById);
    app.get('/getTransactionByBusinessTransactionId/:btId', BackChainWebAPI.getTransactionByBusinessTransactionId);
    app.get('/getTransactionByText/:searchText', BackChainWebAPI.getTransactionByText);
    app.post('/saveBlockChainSettings', BackChainWebAPI.saveBlockChainSettings);
    app.get('/getApplicationSettings', BackChainWebAPI.getApplicationSettings);
    app.post('/startSyncFromCertainDate', BackChainWebAPI.startSyncFromCertainDate);
    app.get('/getSyncStatisticsInfo', BackChainWebAPI.getSyncStatisticsInfo);
    app.post('/startGapSync', BackChainWebAPI.startGapSync);
    app.post('/getDisputes', BackChainWebAPI.getDisputes);
    app.get('/getTransactionsBySequenceNos/:sequenceNos', BackChainWebAPI.getTransactionsBySequenceNos);
    app.get('/getEventsForTransaction/:transId', BackChainWebAPI.getEventsForTransaction);
    app.get('/getTransactionSlice/:payloadId', BackChainWebAPI.getTransactionSlice);
    app.post('/getOpenDisputeCount', BackChainWebAPI.getOpenDisputeCount);
    app.get('/saveDisputeAsDraft/:dispute', BackChainWebAPI.saveDisputeAsDraft);
    app.get('/generateDisputeId/:plainText', BackChainWebAPI.generateDisputeId);
    app.post('/discardDraftDispute/:disputeId', BackChainWebAPI.discardDraftDispute);
    app.post('/registerAddress', BackChainWebAPI.registerAddress);
    app.get('/readBackChainAddressMapping', BackChainWebAPI.readBackChainAddressMapping);
    app.get('/downloadViewDocument/:documentName/:fileName', BackChainWebAPI.downloadViewDocument);
    app.post('/verifyDocumentHashes', BackChainWebAPI.verifyDocumentHashes);
 }
