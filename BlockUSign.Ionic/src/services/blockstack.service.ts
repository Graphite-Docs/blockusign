import { Injectable } from '@angular/core';
import { Document, Log, Message } from './../models/models';
import 'rxjs/add/operator/toPromise';
import { Http, Response } from '@angular/http';
import { Observable } from 'rxjs/Observable';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/catch';
import { AnonymousSubject } from 'rxjs/Subject';
import { Events } from 'ionic-angular';
import { map } from 'rxjs/operators';
import { of } from 'rxjs/observable/of';
import { delay } from 'rxjs/operator/delay';
import { Headers, RequestOptionsArgs, RequestOptions } from '@angular/http';
import { HttpHeaders } from '@angular/common/http';
declare let blockstack: any;
declare let sjcl: any;

@Injectable()
export class BlockStackService {

  public picCache = [];
  public blockusignProfileUrl = "blockusign.profile.json";
  public profile;
  //url = "https://blockusign.co/api/email";
  url = "http://localhost:5000/api/profile";
  public userName;
  public userId;
  public profileName;
 
  constructor(
    public events: Events,
    public http: Http
  ) {
   
  }

  async searchUser(user) {
    // get from server
    let resp = await this.http.get("https://core.blockstack.org/v1/search?query=" + user).map(r => r.json().results).toPromise();
    return resp;
  }

  async getPicUrl(userId) {

    // placeholder
    let picUrl = "https://www.gravatar.com/avatar/?d=identicon";
    try {
      if (!userId) {
        return picUrl;
      }

      // get from cache
      let isInCache = this.picCache.filter(item => item.id === userId)[0];
      if (isInCache) {
        return this.picCache.filter(item => item.id === userId)[0].pic;
      }

      // get from server
      let resp = await this.http.get("https://core.blockstack.org/v1/search?query=" + userId).toPromise();
      let respObj = JSON.parse(resp.text());
      if (respObj.results.length > 0) {
        picUrl = respObj.results[0].profile.image[0].contentUrl
      }
      this.picCache.push({
        id: userId,
        pic: picUrl
      });
    }
    catch (e) {
      console.log('Unable to getpic url')

    }

    return picUrl;

  }

  // blockusign.profile.json
  async getProfileData() {
  
    // this.clearProfileData();

    // do we have an email decryption key?
    let emailKey = await this.getEmailKey();
    if (emailKey == null){
      await this.setEmailKey();
      emailKey = await this.getEmailKey();
    }

    let profileData;
    try {
      profileData = await blockstack.getFile(this.blockusignProfileUrl, { decrypt: false });
    }
    catch(e){
      profileData = await blockstack.getFile(this.blockusignProfileUrl, { decrypt: true });
      this.setProfileData(JSON.parse(profileData).email);
    }
    

    let myProfile = JSON.parse(profileData);
    if (myProfile) {

      // try to decrypt email
      if(typeof(myProfile.email) == "string" ){
        let decryptedEmail = await this.decryptEmail(myProfile.email, emailKey);
      }
      else{
        myProfile.email = undefined;
      }
    

      this.profile = myProfile
      this.userId = blockstack.loadUserData().username || '';
      this.userName = blockstack.loadUserData().username || '';
      this.profileName = blockstack.loadUserData().profile.name || '';
    }

    return JSON.stringify(this.profile);
    //return profileData;
  }

  async setProfileData(email) {
    
    let encryptedEmail = await this.encryptEmail(email, await this.getEmailKey() );

    let storagePath = blockstack.loadUserData().profile.apps[window.location.origin];
    let json = {
      email: encryptedEmail,
      storagePath: storagePath,
      appPublicKey: await this.getAppPublicKey()
    }
    return await blockstack.putFile(this.blockusignProfileUrl, JSON.stringify(json), { encrypt: false });
  }

  getStoragePath(){
    return blockstack.loadUserData().profile.apps[window.location.origin];
  }

  async clearProfileData() {
    
    let json = {
    
    }
    return await blockstack.putFile(this.blockusignProfileUrl, JSON.stringify(json), { encrypt: false });
  }

  async getAppPublicKey(){
    var myPublicKey  = await blockstack.getPublicKeyFromPrivate(blockstack.loadUserData().appPrivateKey);
    return myPublicKey;
  }

  getAppBitcoinAddress(){
    return blockstack.publicKeyToAddress(blockstack.getPublicKeyFromPrivate(blockstack.loadUserData().appPrivateKey));
  }

  getOwnerBitcoinAddress(){
    return blockstack.publicKeyToAddress(blockstack.getPublicKeyFromPrivate(blockstack.loadUserData().appPrivateKey));
  }


  getStorageUrl(){
    return JSON.parse(localStorage.getItem('blockstack-gaia-hub-config')).url_prefix;
  }

  getProfileJsonUrl(){
    // https://gaia.blockstack.org/hub/17xxYBCvxwrwKtAna4bubsxGCMCcVNAgyw/profile.json
    return this.getStorageUrl() + blockstack.loadUserData().identityAddress + '/profile.json';
  }

  async writeGlobalProfile(){
    let httpOptions = new RequestOptions();
    httpOptions.headers = new Headers(
      {
        'Content-Type': 'application/json'
      }
    );
    return await this.http.post("url", JSON.stringify(this.profile), httpOptions)
  }

  async saveAppPublicKey() {
    let resp = await blockstack.putFile('key.json', blockstack.getPublicKeyFromPrivate(blockstack.loadUserData().appPrivateKey) , {encrypt: false});
    return resp;
  }

  async getEmailKey(){
    let resp = await blockstack.getFile('email.key', {decrypt: true});
    return resp;
  }

  async setEmailKey(){
    let emailKey = this.guid(); 
    let resp = await blockstack.putFile('email.key', emailKey , {encrypt: true});
    return resp;
  }

  async encryptEmail(email, key){
    return await sjcl.encrypt(key, email);
  }

  async decryptEmail(email, key){
    let decryt = email;
    try{
      decryt = await sjcl.decrypt(key, email);
    }
    catch(e){
      console.log('need to encrypt');
    }
    return decryt;
  }

  guid() {
    function s4() {
      return Math.floor((1 + Math.random()) * 0x10000)
        .toString(16)
        .substring(1);
    }
    return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
  }

}
