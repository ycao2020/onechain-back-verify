import HomeView from './components/HomeView';
import PayloadView from './components/PayloadView';
import ListTransactionsView from './components/ListTransactionsView';
import SearchByBusinessIdView from './components/SearchByBusinessIdView';
import SearchByTransactionIdView from './components/SearchByTransactionIdView';
import SearchByTextView from './components/SearchByTextView';
import TrackAndVerifyView from './components/TrackAndVerifyView';
import SetupView from './components/SetupView';
import React from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter, Route, Switch } from 'react-router-dom';
import {backChainStore} from './store/BackChainStore';
import BackChainActions from './BackChainActions';

const RoutedApp = () => (
  <BrowserRouter>
    <Switch>
      {/* exact will match /index but not /index/2 etc */}
      <Route exat path="/index" render={(props) => (<HomeView store={backChainStore} {...props}/>)} />
      <Route path="/payload" render={(props) => (<PayloadView store={backChainStore} {...props}/>)} />
      <Route path="/listTransactions" render={(props) => (<ListTransactionsView store={backChainStore} {...props}/>)} />  
      <Route path="/businessId" render={(props) => (<SearchByBusinessIdView store={backChainStore} {...props}/>)} />
      <Route path="/transactionId" render={(props) => (<SearchByTransactionIdView store={backChainStore} {...props}/>)} />
      <Route path="/search" render={(props) => (<SearchByTextView store={backChainStore} {...props}/>)} />
      <Route path="/setup" render={(props) => (<SetupView store={backChainStore} {...props}/>)} />      
    </Switch>
  </BrowserRouter>
);

window.BackchainVerifyAPI = {
  setup: (renderTo, options) => {
    BackChainActions.init(backChainStore);
    
    options = options || {};
    const componentToRender = options.showOnlyVerifyView
      ? <TrackAndVerifyView store={backChainStore} hideProgressBar={true}/>
      : <RoutedApp/>;
    
    if (typeof renderTo == 'string') {
      renderTo = $(renderTo)[0];
    }
    ReactDOM.render(componentToRender, renderTo);
  },

  loadTransactions: (transactions) => {
    BackChainActions.loadTransactions(transactions);
  }
};