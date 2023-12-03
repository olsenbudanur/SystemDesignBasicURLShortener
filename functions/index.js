const {onRequest} = require("firebase-functions/v2/https");
const {getFirestore} = require("firebase-admin/firestore");

const {initializeApp} = require("firebase-admin/app");

initializeApp();

// ************************************************************************************************ //
// HELPER FUNCTIONS
// ************************************************************************************************ //

//
// A really lazy way to create a simple html site lol.
let html_site = `
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>URL Shortener</title>
</head>

<body style="font-family: Arial, sans-serif; margin: 0; padding: 0; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f4f4f4;">
    <div style="text-align: center;">
        <h1 style="margin-bottom: 20px;">URL Shortener</h1>
        <form id="shortenForm">
            <input type="url" id="originalUrl" placeholder="Enter URL to shorten" required style="padding: 10px; width: 300px; border-radius: 5px; border: 1px solid #ccc; margin-right: 10px;">
            <button type="button" onclick="shortenUrl()" style="padding: 10px 20px; border-radius: 5px; border: none; background-color: #007bff; color: #fff; cursor: pointer;">Shorten</button>
        </form>
        <div style="display: flex; flex-direction: column; align-items: center;">
            <p>Your shortened URL:</p>
            <input type="text" id="shortenedUrl" readonly style="padding: 10px; width: 1000px; border-radius: 5px; border: 1px solid #ccc; margin-top: 10px; text-align: center;" disabled>
        </div>
    </div>

    <script>
        function shortenUrl() {
            var originalUrl = document.getElementById('originalUrl').value;
            var requestUrl = 'https://us-central1-living-memories-e74a7.cloudfunctions.net/shorten/' + originalUrl;

            fetch(requestUrl)
                .then(response => response.json())
                .then(data => {
                    document.getElementById('shortenedUrl').value = data.shortenedUrl || 'Error: Unable to shorten URL';
                })
                // .catch(error => {
                //     document.getElementById('shortenedUrl').value = 'Error: ' + error.message;
                // });
        }
    </script>
</body>

</html>
`;

//
// Generate a shortened url
async function generateUniqueID() {
  //
  // Get global ID here. This can be done using a distributed ID generator. 
  // We will use a simple counter for now for simplicity.
  let id = await getGlobalCounter(); 
  let hexaDecimalId = toBase62Hex(id);
  return hexaDecimalId;
}

async function getGlobalCounter() {
  //
  // Make this a transaction, and increment the counter
  const firestore = getFirestore();
  const docRef = firestore.collection('counter').doc('global');
  const docSnapshot = await docRef.get();

  //
  // If the counter does not exist, create it.
  // Just a random number for now.
  if (!docSnapshot.exists) {
    await docRef.set({ count: 24134 });
  }

  //
  // Increment the counter in transaction, and return the counter.
  await firestore.runTransaction(async transaction => {
    const docSnapshot = await transaction.get(docRef);
    const { count } = docSnapshot.data();
    transaction.update(docRef, { count: count + 1 });
  });

  const docSnapshotAfter = await docRef.get();
  const { count } = docSnapshotAfter.data();
  return count;
}

//
// Convert an integer to base 62
function toBase62Hex(integer) {
  //
  // All possible characters that can be used in the shortened URL
  const base62Chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

  //
  // Special case for 0
  if (integer === 0) {
    return '0';
  }

  //
  // Convert the integer to base 62
  let base62 = '';
  while (integer > 0) {
    const remainder = integer % 62;
    base62 = base62Chars[remainder] + base62;
    integer = Math.floor(integer / 62);
  }

  return base62;
}

// ************************************************************************************************ //
// HELPER FUNCTIONS END
// ************************************************************************************************ //

// ************************************************************************************************ //
// CLOUD FUNCTIONS
// ************************************************************************************************ //


//
// Show the url shortener site, simple html page
exports.urlShortener = onRequest(async (req, res) => {
  try {
    res.send(html_site);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('An error occured.');

  }
});
  
//
// Shorten a url
exports.shorten = onRequest(async (req, res) => {
  try {
      //
      // Assuming the original URL is provided in the query parameter 'url'
      const { path } = req;
      let url = path.substring(1); // Remove leading '/'
      if (!url) {
          res.send(html_site);
          return;
      }

      //
      // The user may submit a url without www or with http/https
      // We want to store the url with www and https
      // So we will convert the url to https and www if needed
      if (!url.startsWith('http')) {
        url = 'http://' + url;
      }
      const urlObject = new URL(url);
      const { protocol, hostname } = urlObject;
      const httpsUrl = protocol === 'https:' ? url : url.replace('http:', 'https:');
      const wwwUrl = hostname.startsWith('www.') ? httpsUrl : httpsUrl.replace('//', '//www.');
      url = wwwUrl;

      //
      // Get the firestore instance
      const firestore = getFirestore();

      //
      // Check if we already have the counter collection
      const counterCollection = firestore.collection('counter');
      const csnapshot = await counterCollection.get();
      if (csnapshot.empty) {
        //
        // Create the required collections
        const shortenedUrlsCollection = firestore.collection('shortened-urls');

        //
        // Add a dummy document to each collection, the document name should be
        await shortenedUrlsCollection.doc('olsen').set({ url: "https://www.olsenbudanur.com" });

        //
        // Add the count, the document name should be 'global'. Random counter number init
        await counterCollection.doc('global').set({ count: 23512 });
      }

      //
      // Get the domain name
      const domain = req.get('host');

      //
      // Check if we already have url in db, if so return its shortened url
      const regularUrlsCollection = firestore.collection('shortened-urls');
      const snapshot = await regularUrlsCollection.where('url', '==', url).get();
      if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          const shortenedUrl = doc.id;
          res.json({ shortenedUrl: domain + "/redirect/" + shortenedUrl });
          // res.send("This url is already shortened, here is the shorter URL: " + domain + "/redirect/" + shortenedUrl)
          return;
      }

      //
      // Generate a new shortened url
      const shortenedUrl = await generateUniqueID();

      //
      // Store the shortened url in the db, with the field url: url
      const shortenedUrlsCollection = firestore.collection('shortened-urls');
      await shortenedUrlsCollection.doc(shortenedUrl).set({ url: url });

      //
      // Return the shortened url
      // res.send("Here is the shortened URL: " + domain + "/redirect/" + shortenedUrl);
      res.json({ shortenedUrl: domain + "/redirect/" + shortenedUrl });
  } catch (error) {
    console.error('Error fetching document names:', error);
    res.status(500).json({ error: 'An error occured.' });
  }
});


//
// Redirect to the original url
exports.redirect = onRequest(async (req, res) => {
  try {
    //
    // Get the shortened url from the path
    const { path } = req;
    const shortenedUrl = path.substring(1); // Remove leading '/'
    
    //
    // Get the original url from the db
    const firestore = getFirestore();
    const docRef = firestore.collection('shortened-urls').doc(shortenedUrl);
    const docSnapshot = await docRef.get();
    
    //
    // If the shortened url does not exist, return 404
    if (!docSnapshot.exists) {
      res.status(404).send('Shortened URL not found');
      return;
    }

    //
    // Get the original url
    const { url } = docSnapshot.data();
    
    //
    // Convert the url to https and www if needed
    const urlObject = new URL(url);
    const { protocol, hostname } = urlObject;
    const httpsUrl = protocol === 'https:' ? url : url.replace('http:', 'https:');
    const wwwUrl = hostname.startsWith('www.') ? httpsUrl : httpsUrl.replace('//', '//www.');

    //
    // Redirect to the original url
    res.redirect(301, wwwUrl); 
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('An error occured.');
  }
});


// ************************************************************************************************ //
// CLOUD FUNCTIONS END
// ************************************************************************************************ //


