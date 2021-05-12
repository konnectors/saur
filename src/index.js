process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://e5a5de00a5b944a9a273dc0ca0d91468@sentry.cozycloud.cc/106'

const { rejects } = require('assert')
const {
  BaseKonnector, 
  requestFactory,
  signin,
  scrape,
  saveBills,
  log
} = require('cozy-konnector-libs')
const { resolve } = require('path')
const stream = require('stream')

const urlAccounts = 'https://apib2c.azure.saurclient.fr/admin/auth'

class SaurKonnector extends BaseKonnector
{

  constructor() {
    super()
    this.request = requestFactory({
      // debug: 'json',
      cheerio: false,
      json: true,
      jar: true
    })
    this.ClientID = "test" // Identifiant client
    this.sToken = "tes" // le token d'identification
    this.BillingID = "test" // l'identifiant de facturation
    this.test = "coucou"
  }

  async fetch(fields) {
   
    this.fields = fields

    log('info', 'Authenticating ...')
    await this.authenticate.bind(this)(fields.login, fields.password)
    
    log('info', 'Successfully logged in')
    // The BaseKonnector instance expects a Promise as return of the function
    log('info', 'Fetching the list of documents')
    // cheerio (https://cheerio.js.org/) uses the same api as jQuery (http://jquery.com/)
    log('info', 'Parsing list of documents')
    let documents = await this.parseDocuments()
    
    // here we use the saveBills function even if what we fetch are not bills, but this is the most
    // common case in connectors
    log('info', 'Saving data to Cozy : ' + documents.length)
    
    await saveBills(documents, fields, {
      // this is a bank identifier which will be used to link bills to bank operations. These
      // identifiers should be at least a word found in the title of a bank operation related to this
      // bill. It is not case sensitive.
      identifiers: ['saur']
    })
}

 async authenticate(username, password) {    
    var options = {
      uri: urlAccounts,
      method: 'POST',
      json: {
        "username": username, 
        "password": password, 
        "client_id":"frontjs-client",
        "grant_type":"password",
        "scope":"api-scope"
      }
    };
    
  // Démarre la requête
  // On binde la callback sur le this pour que this contienne l'instance en cours de l'objet
  // et donc pouvoir modifier les membres
  await this.request(options, (function (error, response, body) {
    if (!error && response.statusCode == 200) {

      // Sauvegarde des informations nécessaires
      // Le token d'identification
      this.sToken = 'Bearer ' + body.token.access_token
      // L'identifiant client
      this.ClientID = body.defaultContract.customerAccountId
      // L'identifiant de facturation
      this.BillingID = body.defaultContract.billingAgreementId
  
    }
  }).bind(this));
  

}

  // The goal of this function is to parse a html page wrapped by a cheerio instance
  // and return an array of js objects which will be saved to the cozy by saveBills (https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#savebills)
  async parseDocuments() {

      // Retrieve the bill list
      var docs = []

      var options = {
        headers: {
          'Authorization': this.sToken
        }, 
        uri: "https://apib2c.azure.saurclient.fr/inv/billing_agreements/" + this.BillingID + "/product_invoices",
        method: 'GET'
      };

    // Démarre la requête
      var listeFactures;
      await this.request(options, function (error, response, body) {
        if (!error && response.statusCode == 200) {
          listeFactures = []
        }
  
        listeFactures = body
      })

      for (const stUneFacture of listeFactures){
        // Sauvegarde des informations nécessaires
        // Le token d'identification
        var unDoc = {
          billNumber: stUneFacture.reference,
          amount: stUneFacture.amountIncludingTaxes,
          date: stUneFacture.settlementDate ? stUneFacture.settlementDate : stUneFacture.dueDate
        }
        log('info',stUneFacture.reference)
        var options = {
          headers: {
            'Authorization': this.sToken
          }, 
          uri: "https://apib2c.azure.saurclient.fr/inv/customer_accounts/" + this.ClientID + "/product_invoices/"+ stUneFacture.reference +"/download",
          method: 'GET'
        };
        await this.request(options, (error, response, body) => {
          if (error) 
              return null;
          if (response.statusCode != 200) {
              return ('Invalid status code <' + response.statusCode + '>');
          }
          
          var bufPDF = ''  
          if (body.gedDocuments[0].data)                        
            bufPDF = Buffer.from(body.gedDocuments[0].data, 'base64')
          
          const bufferStream = new stream.PassThrough()
          bufferStream.end(bufPDF)
          unDoc.filestream = bufferStream  

        })

        docs.push(unDoc)

    }

    return docs.map(doc => ({
      ...doc,
      filestream: doc.filestream, 
      filename:
        `${this.formatDate(doc.date)}_saur_${parseFloat(
          doc.amount
        ).toFixed(2)}Eur_` +
        `${doc.billNumber}` +
        '.pdf',
      // the saveBills function needs a date field
      date: new Date(doc.date),
      currency: '€',
      vendor: 'saur',
      amount: parseFloat(doc.amount),
      metadata: {
        // it can be interesting that we add the date of import. This is not mandatory but may be
        // useful for debugging or data migration
        importDate: new Date(),
        // document version, useful for migration after change of document structure
        version: 1
      }
    }))
  }

  // Convert a Date object to a ISO date string
  formatDate(date) {  
    var dDate = new Date(Date.parse(date))
    
    let year = dDate.getFullYear()
    let month = dDate.getMonth() + 1
    let day = dDate.getDate()
    if (month < 10) {
      month = '0' + month
    }
    if (day < 10) {
      day = '0' + day
    }
    return `${year}-${month}-${day}`
  }

}

const connector = new SaurKonnector()

connector.run()