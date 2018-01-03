import React from 'react';
import { observer } from 'mobx-react';
import { Row, Col, Button, Panel, FormControl} from 'react-bootstrap';
import { Link, Redirect } from 'react-router-dom';
import BackChainActions from '../BackChainActions';
import HeaderView from "./HeaderView";
import moment from 'moment';
import Datetime from 'react-datetime';
import 'react-datetime/css/react-datetime.css';

@observer export default class StartSyncView extends React.Component {
	constructor(props) {
		super(props);
		this.startSync = this.startSync.bind(this);
		this.state = {startSync: false}
	}

	startSync() {
		this.state.startSync = true;
	}

	render() {
		let syncPopupBody = null;
		if(!this.state.startSync) {
			syncPopupBody = <SyncForm startSync = {this.startSync} store = {this.props.store}/>;
		} 
		
		if(this.props.store.syncGoingOn == true && this.state.startSync) {
			syncPopupBody = <SyncRefresh msgs = {["Refreshing your database.", "This may take a few minutes."]} btnName= "OK"/>
		} else if(this.props.store.syncGoingOn == false && this.state.startSync && this.props.store.syncFailed == false) {
			syncPopupBody = <SyncDone msg = {"Your database has been successfully refreshed!"}/>
		}

		if(this.props.store.syncGoingOn == false && this.state.startSync && this.props.store.syncFailed == true) {
			syncPopupBody = <SyncFailed msg = {"Sync Failed. Please Try Again Later!"}/>
		}

		return (
			<div>
				<HeaderView store={this.props.store} size="big"/>
				<SyncPopup title = "Sync My Database with One Network's Chain of Custody" body = {syncPopupBody} />
			</div>
		)
	}
}

class SyncForm extends React.Component {
	constructor(props) {
		super(props);
	}

	listenTokenChanges(event){
		this.props.store.authenticationToken  = event.target.value.trim();		
		if ( this.props.store.authenticationToken.length > 0 && event.charCode  == 13) {
			this.startSync();
		}
	}

	listenStartFromChanges(date){
		this.props.store.lastSyncTimeInMillis  = date.valueOf();
	}

	listenURLChanges(event){
		this.props.store.chainOfCustodyUrl  = event.target.value.trim();
	}

	startSync() {
		this.props.startSync();
		BackChainActions.startSync(this.props.store.authenticationToken, this.props.store.lastSyncTimeInMillis, this.props.store.chainOfCustodyUrl);
	}

	render() {
		let fieldProps = {
			button : {
				height: '35px',
				boxShadow: '1px 2px 2px rgba(0, 0, 0, 0.749019607843137)',
				fontStyle: 'normal',
    			fontSize: '16px'
			}
		};

		if(!this.props.store.authenticationToken) {
			this.props.store.lastSyncTimeInMillis = moment().startOf('year');
		} 

		return (
			<div>
				<Row>
					<FormControl type="text" defaultValue = {this.props.store.chainOfCustodyUrl} onKeyPress={this.listenURLChanges.bind(this)} onChange={this.listenURLChanges.bind(this)} placeholder={this.props.store.chainOfCustodyUrl} /><br/>
				</Row>
				<Row>
					<FormControl type="text" defaultValue = {this.props.store.authenticationToken} onKeyPress={this.listenTokenChanges.bind(this)} onChange={this.listenTokenChanges.bind(this)} placeholder="Oauth Token" /><br/>
				</Row>
				<Row>
					<Datetime defaultValue={this.props.store.lastSyncTimeInMillis} inputProps={{placeholder: "mm/dd/yyyy"}} closeOnSelect={true} dateFormat="MM/DD/YYYY" onChange={this.listenStartFromChanges.bind(this)} timeFormat={false}/>
					<br/>
				</Row>
				<Row>
					<Button bsStyle="primary" style={fieldProps.button} onClick={this.startSync.bind(this)}>Start Sync</Button>
					<Button style={Object.assign({}, {marginLeft:'10px',color:'#0078D7',borderColor:'#0078D7'}, fieldProps.button)}>Cancel</Button>
				</Row>
			</div>
		)
	}
}

const SyncPopup = (props) => {
	let fieldProps = {
		panel : {
			backgroundColor: 'rgba(250, 250, 250, 1)',
			border:'none',
			marginBottom: 'unset'
		},
		panelBodyTitle : {	
			fontSize: '22px',
			color: '#515151'
		},
		panelTitle : {
			fontWeight: 'bold',
			display: 'inline-block',
			color: '#646464'
		},
		panelBody: {
			padding: '70px 0px 20px 80px',
			backgroundColor: 'white'
		}
	};

	let panelBody = (<div style={{height: '100%', width: '92%'}}>
						<Row style={fieldProps.panelBodyTitle}>
							<Col md={1} style={{width: '5%', height: '30px'}}>
							<span>
								<i className="fa fa-database" aria-hidden="true"></i>&nbsp;&nbsp;
							</span>
							</Col>
							<Col> {props.title} </Col>
						</Row><hr/><br/>
						<Row style={{padding : '0em 30em 1em 2.2em'}}>
							{props.body}
						</Row>
					</div>);

	return (
		<div className={"panel panel-default"} style={fieldProps.panel}>
			<div className={"panel-body"} style={fieldProps.panelBody}>
				{panelBody}
			</div>
		</div>
	);
}

const SyncRefresh = (props) => {
	let fieldProps = {
		button : {
			height: '35px',
			boxShadow: '1px 2px 2px rgba(0, 0, 0, 0.749019607843137)',
			fontStyle: 'normal',
			fontSize: '16px'
		}
	}

	return (
		<div>
			<Row style={{paddingLeft:'90px'}}>
				<Col style={{color:'#0085C8'}} md={1}><i className="fa fa-refresh fa-spin fa-4x fa-fw"></i></Col>
				<Col style={{paddingLeft:'50px', fontSize:'20px', color:'#515151'}} md={10}>
					{props.msgs.map(i => {
						return <div key={i}>{i}</div>;
					})}
				</Col>
			</Row><br/>
			<Row>
				<Col md={5}></Col>
				<Col md={2}>
					<Button bsStyle="primary" style={Object.assign({}, fieldProps.button, {width: '80px'})}> {props.btnName} </Button>
				</Col>
			</Row>
		</div>
	)
}

const SyncDone = (props) => {
	return (
		<Row style={{paddingLeft:'90px'}}>
			<Col style={{color:'#3c763d'}} md={1}><i className="fa fa-check-circle fa-4x fa-fw"></i></Col>
			<Col style={{paddingLeft:'50px', fontSize:'20px', color:'#515151'}} md={10}>
				{props.msg}
			</Col>
		</Row>
	)
}

const SyncFailed = (props) => {
	return (
		<Row style={{paddingLeft:'90px'}}>
			<Col style={{color:'#bb0400'}} md={1}><i className="fa fa-times fa-4x fa-fw"></i></Col>
			<Col style={{paddingLeft:'50px', fontSize:'20px', color:'#515151', paddingTop: '12px'}} md={10}>
				{props.msg}
			</Col>
		</Row>
	)
}