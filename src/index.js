const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log
} = require('cozy-konnector-libs')
const request = requestFactory({
  // the debug mode shows all the details about http request and responses. Very useful for
  // debugging but very verbose. That is why it is commented out by default
  // debug: true,
  // activates [cheerio](https://cheerio.js.org/) parsing on each page
  cheerio: true,
  // If cheerio is activated do not forget to deactivate json parsing (which is activated by
  // default in cozy-konnector-libs
  json: false,
  // this allows request-promise to keep cookies between requests
  jar: true
})

const baseUrl = 'https://mon-espace.saurclient.fr/EspaceClient/'

module.exports = new BaseKonnector(start)

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  // The BaseKonnector instance expects a Promise as return of the function
  log('info', 'Fetching the list of documents')
  const $ = await request(`${baseUrl}/Factures.aspx`)
  // cheerio (https://cheerio.js.org/) uses the same api as jQuery (http://jquery.com/)
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($)

  // here we use the saveBills function even if what we fetch are not bills, but this is the most
  // common case in connectors
  log('info', 'Saving data to Cozy')
  await saveBills(documents, fields, {
    // this is a bank identifier which will be used to link bills to bank operations. These
    // identifiers should be at least a word found in the title of a bank operation related to this
    // bill. It is not case sensitive.
    identifiers: ['saur']
  })
}

// this shows authentication using the [signin function](https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#module_signin)
// even if this in another domain here, but it works as an example
function authenticate(username, password) {
  return signin({
    url: 'https://mon-espace.saurclient.fr/Authentification/LoginPage.aspx',
    formSelector: 'form',
    formData: {
      ctl00$Content$Login$email: username,
      ctl00$Content$Login$pwd: password,
      ctl00$Content$Login$btnConnect: 'Valider'
    },
    // the validate function will check if the login request was a success. Every website has
    // different ways respond: http status code, error message in html ($), http redirection
    // (fullResponse.request.uri.href)...
    validate: (statusCode, $) => {
      // The login in toscrape.com always works excepted when no password is set
      if (
        $(
          `a[href='javascript:__doPostBack('ctl00$Menu$lkbDeconnecterClient','')']`
        ).length >= 1
      ) {
        return true
      } else {
        // cozy-konnector-libs has its own logging function which format these logs with colors in
        // standalone and dev mode and as JSON in production mode
        log('error', 'impossible de trouver le lien deconnecter')
        return false
      }
    }
  })
}

// The goal of this function is to parse a html page wrapped by a cheerio instance
// and return an array of js objects which will be saved to the cozy by saveBills (https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#savebills)
function parseDocuments($) {
  // you can find documentation about the scrape function here :
  // https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#scrape
  var sNumFacture = $('div.flexrow')
    .find($('div.control'))
    .eq(0)
    .text()
    .trim()
  var sMontant = $('div.flexrow')
    .find($('div.control'))
    .eq(1)
    .text()
    .trim()
  var sDate = $('div.flexrow')
    .find($('div.control'))
    .eq(2)
    .text()
    .trim()
  var sLien =
    baseUrl + '/' + $('#Content_rptDerniereFacture_HyperLink1_0').attr('href')

  //  log('info','Facture en cours ' + sNumFacture);
  //  log('info','Facture en cours ' + normalizePrice(sMontant));
  //  log('info','Facture en cours ' + sDate);
  //  log('info','Facture en cours ' + sLien);
  var docs = []
  docs = scrape(
    $,
    {
      billNumber: {
        sel: 'td:nth-child(1)'
      },
      amount: {
        sel: 'td:nth-child(2)',
        parse: normalizePrice
      },
      fileurl: {
        sel: 'td:nth-child(4)>div>a',
        attr: 'href',
        parse: href => `${baseUrl}/${href}`
      },
      date: {
        sel: 'td:nth-child(3)'
      }
    },
    '.footable tbody tr'
  )

  docs.push({
    billNumber: sNumFacture,
    amount: normalizePrice(sMontant),
    fileurl: sLien,
    date: sDate
  })

  log('info', docs.length)
  return docs.map(doc => ({
    ...doc,
    fileurl: doc.fileurl,
    filename:
      `${formatDate(normalizeDate(doc.date))}_saur_${parseFloat(
        doc.amount
      ).toFixed(2)}Eur_` +
      `${doc.billNumber}` +
      '.pdf',
    // the saveBills function needs a date field
    date: normalizeDate(doc.date),
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

// convert a price string to a float
function normalizePrice(price) {
  price = price.replace(new RegExp(' ', 'g'), '')
  price = price.replace(new RegExp(',', 'g'), '.')

  price = price.trim()
  return parseFloat(price)
}

// "Parse" the date found in the bill page and return a JavaScript Date object.
function normalizeDate(date) {
  const [day, month, year] = date.split('/')
  return new Date(`${year}-${month}-${day}`)
}

// Convert a Date object to a ISO date string
function formatDate(date) {
  let year = date.getFullYear()
  let month = date.getMonth() + 1
  let day = date.getDate()
  if (month < 10) {
    month = '0' + month
  }
  if (day < 10) {
    day = '0' + day
  }
  return `${year}-${month}-${day}`
}
