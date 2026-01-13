import fp from 'fastify-plugin';
import admin from 'firebase-admin';
import geoFirestore from 'geofirestore';
import credentials from '../../firebase/key.json' with { type: 'json' };

function ensureFirebaseInitialized() {
  if (admin.apps.length) return;
  admin.initializeApp({
    credential: admin.credential.cert(credentials),
  });
}

ensureFirebaseInitialized();

export { admin };
export const firestore = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;

export const GeoFirestore = null;

async function firebasePlugin(fastify, options) {
  if (!admin.apps.length) {
    try {

      admin.initializeApp({
        credential: admin.credential.cert(credentials),
      });

      fastify.log.info('Firebase Admin initialized successfully');
    } catch (error) {
      fastify.log.error('Firebase Admin initialization error:', error);
      throw error;
    }
  }

  const firestore = admin.firestore();
  
  firestore.settings({
    ignoreUndefinedProperties: true, 
    timestampsInSnapshots: true,
  });

  const GeoFirestore = geoFirestore.initializeApp(firestore);
  const FieldValue = admin.firestore.FieldValue;

  fastify.decorate('firebase', {
    admin,
    firestore,
    GeoFirestore,
    FieldValue,
  });


  fastify.log.info('Firebase plugin registered successfully');
}

export default fp(firebasePlugin, {
  name: 'firebase-plugin',
  fastify: '5.x',
});    
