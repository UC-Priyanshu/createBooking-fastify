import fp from 'fastify-plugin';
import admin from 'firebase-admin';
import geoFirestore from 'geofirestore';
import credentials from '../../firebase/key.json' with { type: 'json' };

let firestoreInstance = null;
let geoFirestoreInstance = null;

async function firebasePlugin(fastify) {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(credentials),
    });

    fastify.log.info('Firebase Admin initialized');
  }

  if (!firestoreInstance) {
    firestoreInstance = admin.firestore();

    firestoreInstance.settings({
      ignoreUndefinedProperties: true,
    });

    geoFirestoreInstance = geoFirestore.initializeApp(firestoreInstance);

    fastify.log.info('Firestore initialized');
  }

  // Decorate once
  fastify.decorate('firebase', {
    admin,
    firestore: firestoreInstance,
    GeoFirestore: geoFirestoreInstance,
    FieldValue: admin.firestore.FieldValue,
  });
}

export default fp(firebasePlugin, {
  name: 'firebase-plugin',
  fastify: '5.x',
});
