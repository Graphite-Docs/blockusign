import { Injectable } from '@angular/core';
import { Document, Log, Message, DocStorageMaps } from './../models/models';
import 'rxjs/add/operator/toPromise';
import { Http, Response } from '@angular/http';
import { Observable } from 'rxjs/Observable';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/catch';
import { AnonymousSubject } from 'rxjs/Subject';
import { Events } from 'ionic-angular';
import * as moment from 'moment';
import * as Automerge from 'automerge/dist/automerge.js';
import { BlockStackService } from './blockstack.service';
import { State } from './../models/state';
import { of } from 'rxjs/observable/of';
declare let jslinq: any;
declare let blockstack: any;
declare let sjcl: any;
declare let $: any;


@Injectable()
export class DocumentService {

  private indexFileName = "blockusign/documents.index.json";
  public documentsList: Array<Document>;
  public documentsListFiltered: Array<Document>;
  public docBuffer: any;
  public currentDoc: Document;
  public currentDocAnnotationsDoc;
  public currentDocAnnotations;
  public logDoc: any;
  public log: Log;
  public docStorageMaps: DocStorageMaps;
  public urlBlockusignGlobalStore = "https://gaia.blockstack.org/hub/1PoZGGAuQ4yPj72TrXbG4pKbgB9tvCUqQ1/blockusign";
  public urlBlockusign =  "https://blockusign.co"; //"https://blockusign.co"; // "http://localhost:52657";
 

  constructor(
    public events: Events, 
    private http: Http,
    private blockStackService: BlockStackService
  ) {
    console.log('Hello StorageServiceProvider Provider');
    this.documentsList = [];

    // @TODO - think about putting in checks here is documentsList is empty, 
    // or there could be a async race-condition issue if they take too long to come back
    this.getDocumentsIndex(true).then((data) => {
      this.documentsList = data;
    });

  }

  async getDocumentsIndex(refresh: boolean) {
    if (refresh) {
      let resp = await blockstack.getFile(this.indexFileName, { decrypt: true });
      if (resp) {
        this.documentsList = JSON.parse(resp);
      }
      if (this.documentsList == null || !resp) {
        this.documentsList = JSON.parse(await blockstack.putFile(this.indexFileName, "[]", { encrypt: true }));
      }
      this.documentsListFiltered = this.documentsList;
    }
    return this.documentsList;
  }


  async addDocument(fileName: string, fileBuffer: any) {
    let newDocument = new Document();
    newDocument.fileName = fileName;
    newDocument.documentKey = this.generateKey();
    newDocument.code = this.generateKey();

    // write to /api/Code?docGuid=12345&code=12345
    await this.writeCode(newDocument.guid, newDocument.code);
    // add my storage path - write to /api/DocStorageMap?docGuid=12345&code=12345&storagePath=urlEncode(pathToStorage)
    await this.addDocStoragePath(newDocument.guid, newDocument.code, blockstack.loadUserData().profile.apps[window.location.origin]);

    newDocument.pathAnnotatedDoc = blockstack.loadUserData().profile.apps[window.location.origin];
    let profileData = await this.blockStackService.getProfileData();
    let myEmail = null;
    if (profileData){
      myEmail = JSON.parse(profileData).email;
    }
    newDocument.paths = [{
      name: blockstack.loadUserData().profile.name, 
      userId: blockstack.loadUserData().username, 
      email: myEmail,
      appPublicKey: await this.blockStackService.getAppPublicKey(),
      pathToStorage: blockstack.loadUserData().profile.apps[window.location.origin]
    }];
    newDocument.signer = [];
    this.documentsList.push(newDocument);
    await blockstack.putFile(this.indexFileName, JSON.stringify(this.documentsList), { encrypt: true });
    this.docBuffer = fileBuffer;
    this.currentDoc = newDocument;
    let response = await this.addDocumentBytes(newDocument.guid, fileBuffer, newDocument.documentKey);
    return this.documentsList;
  }

  async updateDocument(documentGuid, doc){
    // find in array 
    let index = this.documentsList.findIndex(i => i.guid === documentGuid);
    // update
    if (index !== -1) {
      this.documentsList[index] = doc;
      // write document index
      await blockstack.putFile(this.indexFileName, JSON.stringify(this.documentsList), { encrypt: true });
      return true;
    }
    return false;
  }

 

  async removeDocument(document) {
    // remove item
    this.documentsList = (<any>this.documentsList).remove(document);
    await blockstack.putFile(this.indexFileName, JSON.stringify(this.documentsList), { encrypt: true });
    await this.removeDocumentBytes(document.guid);
    // remove binary file
    return this.documentsList;
  }

  async addDocumentBytes(guid: string, doc: any, documentKey: string) {
    let encryptedDoc = this.ecryptDoc(doc, documentKey);
    // add blank annotations file
    await this.createAnnotations(guid);
    // add blank log file
    await this.getLog(guid,true);
    return blockstack.putFile(guid + ".pdf", encryptedDoc, { encrypt: false }).then((data) => { });
  }

  async getDocument(fileName: string, documentKey: string) {
    let resp = await blockstack.getFile(fileName, { decrypt: false });
    if (resp) {
      let encryptedDoc = resp;
      return this.decryptDoc(encryptedDoc, documentKey);
    }
    else {
      return null;
    }
  }

  async getDocumentByPath(docPath: string, docKey: string) {
    let resp = await this.http.get(docPath).toPromise();
    if (resp) {
      let encryptedDoc = resp.text();
      return this.decryptDoc(encryptedDoc, docKey);
    }
    else {
      return of(null);
    }
  }

  async copyDocument(newDocument: Document, guid: string, fileBuffer: any) {
    console.log("file buffer", fileBuffer);
    console.log("guid", guid);
    console.log("doc", newDocument);

    let myName = null;
    if (blockstack.loadUserData().profile.name){
      myName = blockstack.loadUserData().profile.name;
    }
    let myUserId = null;
    if(blockstack.loadUserData().username){
      myUserId = blockstack.loadUserData().username;
    }
    let profileData = await this.blockStackService.getProfileData();
    let myEmail = null;
    if (profileData){
      myEmail = JSON.parse(profileData).email;
    }
    
    newDocument.paths.push({
      name: myName, 
      userId: myUserId, 
      email: myEmail,
      appPublicKey: await this.blockStackService.getAppPublicKey(),
      pathToStorage: blockstack.loadUserData().profile.apps[window.location.origin]
    });

    this.documentsList.push(newDocument);
    console.log("new doc list", this.documentsList );
    await blockstack.putFile(this.indexFileName, JSON.stringify(this.documentsList), { encrypt: true });
    this.currentDoc = newDocument;
    //let response = await this.addDocumentBytes(guid, fileBuffer, newDocument.documentKey);
    this.docBuffer = fileBuffer;
    let encryptedDoc = this.ecryptDoc(fileBuffer, this.currentDoc.documentKey);
    let r = await blockstack.putFile(guid + ".pdf", encryptedDoc, { encrypt: false }).then((data) => { });


    // add my storage path - write to /api/DocStorageMap?docGuid=12345&code=12345&storagePath=urlEncode(pathToStorage)
    await this.addDocStoragePath(newDocument.guid, newDocument.code, blockstack.loadUserData().profile.apps[window.location.origin]);

    //  now copy annotations
    let annotsResp = await this.getAnnotationsByPath(this.currentDoc.pathAnnotatedDoc + guid + ".annotations.json", this.currentDoc.documentKey);
    if (annotsResp) {
      this.saveAnnotations(guid, this.currentDocAnnotations.annotations);
    }
    else{
      this.saveAnnotations(guid, "");
    }

    // now copy chat log
    let theirPath = jslinq(this.currentDoc.paths).where( (el) => el.email != this.blockStackService.profile.email  ).toList();
    if (theirPath){
      try{
        let theirUrl = theirPath[0].pathToStorage + guid + '.log.json';
        let theirLogDoc = await this.getLogByPath(theirUrl, this.currentDoc.documentKey);
        if (theirLogDoc) {
          let logStr = Automerge.save(theirLogDoc);
          await this.saveLog(guid, logStr);
        }
        else{
          // nothing
        }
      }
      catch (e) { console.log(e); }
    }
   
    return this.documentsList;
  }

  documentExists(guid): boolean {
    let exists = false;
    let docs = jslinq(this.documentsList).where(  (el) => el.guid == guid ).toList();
    if (docs.length > 0){
      exists = true;
    }
    return exists;
  }


  async removeDocumentBytes(guid: string) {
    await blockstack.putFile(guid + ".annotations.json", "", { encrypt: false });
    await blockstack.putFile(guid + ".log.json", "", { encrypt: false });
    return blockstack.putFile(guid + ".pdf", "", { encrypt: false }).then((data) => { });
  }


  async createAnnotations(guid: string) {
    let json = {
      annotations: ""
    }
    this.currentDocAnnotationsDoc = Automerge.init();
    let commit = blockstack.loadUserData().profile.name + " created annotations on " + this.getDate(); 
    this.currentDocAnnotationsDoc = Automerge.change(this.currentDocAnnotationsDoc, commit, doc => {
      doc.annots = [];
    });
    let saveAnnotStr = Automerge.save(this.currentDocAnnotationsDoc);
    let encrypted = this.encryptString(saveAnnotStr, this.currentDoc.documentKey);
    return await blockstack.putFile(guid + ".annotations.json", encrypted, { encrypt: false });
  }

  async saveAnnotations(guid: string, annotation: string) {
    let json = {
      annotations: annotation
    }
    let commit = blockstack.loadUserData().profile.name + " added annotation on " + this.getDate(); 
    this.currentDocAnnotationsDoc = Automerge.change(this.currentDocAnnotationsDoc, commit, doc => {
      doc.annots.insertAt(0, json);
    });
    let saveAnnotStr = Automerge.save(this.currentDocAnnotationsDoc);
    let encrypted = this.encryptString(saveAnnotStr, this.currentDoc.documentKey);
    return await blockstack.putFile(guid + ".annotations.json", encrypted, { encrypt: false });
  }

  async getAnnotations(guid: string) {

    let annoatationsFileName = guid + ".annotations.json";
    let resp = await blockstack.getFile(annoatationsFileName, { decrypt: false });
    if (resp) {
      let decrypted = this.decryptString(resp, this.currentDoc.documentKey);
      this.currentDocAnnotationsDoc = Automerge.load(decrypted);
      this.currentDocAnnotations =  this.currentDocAnnotationsDoc.annots[0];//JSON.parse(decrypted);
      // now merge annotations
      let theirPath = jslinq(this.docStorageMaps.storagePaths).where( (el) => el != blockstack.loadUserData().profile.apps[window.location.origin]  ).toList();
      // @todo in the future maybe support mutiple parties signing a doc and allow more than 2 storage paths
      let theirUrl = theirPath[0];
      if (theirUrl){
        let url = theirUrl + annoatationsFileName;
        let theirResp = await this.http.get(url).toPromise(); 
        // now merge their doc into mine
        if (theirResp){
          let str = theirResp.text();
          str = this.decryptString(str, this.currentDoc.documentKey);
          let theirDoc = Automerge.load(str);
          let finalDoc = Automerge.merge(theirDoc, this.currentDocAnnotationsDoc)
          this.currentDocAnnotationsDoc = finalDoc;
        }
      }
      this.currentDocAnnotations = this.currentDocAnnotationsDoc.annots[0];

    }
    if (!resp) {
      this.currentDocAnnotations = "";
    }

   
    return this.currentDocAnnotations;
  }

  async getAnnotationsByPath(docPath: string, docKey: string): Promise<any> {
    // @todo WIP
    let resp = await this.http.get(docPath).toPromise();
    if (resp) {
      let encryptedDocStr = JSON.stringify(resp.json());
      let annotations = this.decryptString(encryptedDocStr, docKey);
      this.currentDocAnnotationsDoc = Automerge.load(annotations);
      this.currentDocAnnotations =  this.currentDocAnnotationsDoc.annots[0];
      //this.currentDocAnnotations = JSON.parse(annotations);
    }
    if (!resp) {
      this.currentDocAnnotations = "";
    }
    return this.currentDocAnnotations;
  }


  async setCurrentDoc(guid: string) {
    //alert('set curr doc');
    this.currentDoc = this.documentsList.find(x => x.guid == guid);

    await this.getDocStorageMaps(this.currentDoc.guid);

    this.events.publish('documentService:setCurrentDoc', this.currentDoc);
    let span = "span:contains('" + this.currentDoc.fileName + "')";
    $(document).ready(function () {
      $(".channels-list-text li").removeClass('active');
      let s = $(span);
      s.parent().addClass('active');
    });
  }


  //#region Log (Chat)
  async getLog(guid: string, create?: boolean) {
    let logFileName = guid + '.log.json';
    let resp = null;
    try {

      if (!create){
        resp = await blockstack.getFile(logFileName, { decrypt: false }); 
      }
     
      // existing doc
      if (resp) {
          this.logDoc = this.decryptString(resp, this.currentDoc.documentKey);
          this.logDoc =  Automerge.load(this.logDoc);
          this.log = this.logDoc.log;
          let theirPath = jslinq(this.docStorageMaps.storagePaths).where( (el) => el != blockstack.loadUserData().profile.apps[window.location.origin]  ).toList();
          let theirUrl = theirPath[0];
          if (theirUrl){
            let url = theirUrl + logFileName;
            let theirResp = await this.http.get(url).toPromise(); 
            // now merge their doc into mine
            if (theirResp){
              let str = theirResp.text();
              str = this.decryptString(str, this.currentDoc.documentKey);
              let theirDoc = Automerge.load(str);
              let finalDoc = Automerge.merge(theirDoc, this.logDoc)
              this.logDoc = finalDoc;
            }
          }
          this.log = this.logDoc.log;
      }
      // init new doc
      else {
        let newLog = new Log();
        newLog.messages = [];
        let msg = new Message();
        msg.createdBy = this.blockStackService.userName;
        msg.createdByName = this.blockStackService.profileName;
        msg.email = this.blockStackService.profile.email;
        msg.message = "Created Doc";
        newLog.messages.push(msg);
        this.logDoc = Automerge.init();
        this.logDoc = Automerge.change(this.logDoc, 'Initialize log - ' + this.getDate(), doc => {
          doc.log = newLog;
        });
        let logStr = Automerge.save(this.logDoc);
        logStr = this.encryptString(logStr, this.currentDoc.documentKey)
        logStr = await blockstack.putFile(logFileName, logStr, { encrypt: false });
        logStr = this.decryptString(logStr, this.currentDoc.documentKey);
        console.log('logstr', logStr);
        this.logDoc = Automerge.load(logStr);
        this.log = this.logDoc.log;
        //this.log = JSON.parse(await blockstack.putFile(logFileName, JSON.stringify(newLog), { encrypt: false }));
      }
      return this.log;
    }
    catch (e) {
      //throw e;
    }
  }

  async saveLog(guid: string, logStr: string) {
    let logFileName = guid + '.log.json';
    logStr = this.encryptString(logStr, this.currentDoc.documentKey)
    logStr = await blockstack.putFile(logFileName, logStr, { encrypt: false });
  }

  async getLogByPath(docPath, docKey){
     let resp = await this.http.get(docPath).toPromise();
     if (resp) {
       let encryptedDocStr = JSON.stringify(resp.json());
       let chatLog = this.decryptString(encryptedDocStr, docKey);
       this.logDoc = Automerge.load(chatLog);
       this.log =  this.logDoc.log;
     }
     if (!resp) {
       this.log = null;
     }
    return this.logDoc;
  }

  async addMessage(guid: string, message: string) {
    let logFileName = guid + ".log.json"
    let log = await this.getLog(guid);
    if (log) {
      let msg = new Message();
      msg.message =  message; //encodeURIComponent(message);
      msg.createdBy = this.blockStackService.userName;
      msg.createdByName = this.blockStackService.profileName
      msg.email = this.blockStackService.profile.email;
      this.logDoc = Automerge.change(this.logDoc, msg.createdByName + " added message at " + this.getDate() ,  (doc) => {
        doc.log.messages.push(msg);
      });
      //log.messages.push(msg);
      let logStr = Automerge.save(this.logDoc);
      logStr = this.encryptString(logStr, this.currentDoc.documentKey);
      await blockstack.putFile(logFileName, logStr, { encrypt: false });
      this.log = this.logDoc.log;
      this.events.publish('documentService:addedChat', msg);
      return this.log;
      //return await blockstack.putFile(logFileName, JSON.stringify(log), { encrypt: false });
    }
    else {
      console.error("error getting log file: " + logFileName)
    }
  }
  //#endregion


  async mergeDocumentPaths(fileGuid){

    let thisGuid = fileGuid || this.currentDoc.guid;

    // 1. get the all the locations this document is stored from the global storage index
    let allPathToThisDocument: any = await this.getDocStorageMaps(thisGuid);
    console.log(allPathToThisDocument);

    // 2. ignore my path and loop all the other paths
    let myStoragePath = this.blockStackService.getStoragePath();
    // console.log(myStoragePath);
    allPathToThisDocument.storagePaths.remove(myStoragePath);

    // 3. Update my currentDoc.paths[i] to contain their state data
    for( let path of allPathToThisDocument.storagePaths ) { 
      console.log(path) 
      // get the remote from their bucket with the symetric key

      // updateMyDocument with Merge Diff
    }


  }

  async updatePartnerPathData(){
    
  }

  async writeCode(docGuid, code){
    return this.http.get(this.urlBlockusign + "/api/Code?docGuid="+docGuid+"&code=" + code).toPromise();
  }

  async addDocStoragePath(docGuid, code, storagePath){
    var encodedStoragePath = encodeURIComponent(storagePath);
    var url = "/api/DocStorageMap?docGuid="+docGuid+"&code=" + code + "&storagePath=" + encodedStoragePath;
    return this.http.get(this.urlBlockusign + url).toPromise();
  }


  async getDocStorageMaps(docGuid){
    var resp = await this.http.get(this.urlBlockusignGlobalStore + "/" + docGuid + ".doc.storage.map.json").toPromise();
    this.docStorageMaps = resp.json();
    return this.docStorageMaps;
  }

 

  //#region Encryption
  //https://stackoverflow.com/questions/26734033/encrypting-files-with-sjcl-client-side
  ecryptDoc(doc: any, key: string) {
    let docBits = sjcl.codec.arrayBuffer.toBits(doc);
    let base64bits = sjcl.codec.base64.fromBits(docBits);
    let encryptedDoc = sjcl.encrypt(key, base64bits);
    return encryptedDoc;
  }
  decryptDoc(encryptedDoc, key: string) {
    let dec = sjcl.decrypt(key, encryptedDoc);
    let decryptedBase64 = sjcl.codec.base64.toBits(dec);
    let decryptedDocBits = sjcl.codec.arrayBuffer.fromBits(decryptedBase64);
    return decryptedDocBits;
  }
  encryptString(payload:string, key: string) {
    let encryptedDoc = sjcl.encrypt(key, payload);
    return encryptedDoc;
  }
  decryptString(payload: string, key: string) {
    let dec = sjcl.decrypt(key, payload);
    return dec;
  }
  generateKey() {
    return (<any>window).guid();
  }
  genHash(data){
    // @todo get a hash of the document buffer, also get a hash of the string annotations svg
    // then hash those two parts together, just like a merkle tree in ethereum!
    let hashBits = sjcl.hash.sha256.hash(data);
    let hashStr = sjcl.codec.base64.fromBits(hashBits);
    return hashStr;
  }

  async getMerkleHash(){
    let annotationsHash = this.genHash(this.currentDocAnnotations.annotations);
    
    let pdfBuffer = await this.getDocument(this.currentDoc.guid + ".pdf", this.currentDoc.documentKey);
    let pdfData = new Uint8Array(pdfBuffer);
    let docHash = this.genHash(pdfBuffer);

    let chatData = JSON.stringify(await this.getLog(this.currentDoc.guid));
    let chatHash = this.genHash(chatData);

    let merkleHash = this.genHash(docHash + annotationsHash + chatData);

    return merkleHash;
     
  }

  //#endregion

  // watchout
  async resetStorage() {
    await blockstack.putFile(this.indexFileName, "[]", { encrypt: true });
  }

  getDate() {
    let d = Date();
    return d;
  }

  async filterDocuments(signer){
    if (signer == "all"){
      this.documentsListFiltered = this.documentsList;
    }
    else{
      this.documentsListFiltered = jslinq(this.documentsList).where( (el) => el.signer[0] == signer ).toList();
    } 
    return this.documentsListFiltered;
  }

  
}

