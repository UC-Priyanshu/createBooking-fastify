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

// Provide stable named exports for modules that need direct access.
// This keeps Fastify decoration working while avoiding import-time crashes.
ensureFirebaseInitialized();

export { admin };
export const firestore = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;
// NOTE: GeoFirestore is intentionally not initialized at module load.
// It is initialized inside the Fastify plugin after Firestore settings are applied.
export const GeoFirestore = null;

async function firebasePlugin(fastify, options) {
  // Only initialize if not already initialized
  if (!admin.apps.length) {
    try {

      // Initialize Firebase Admin
      admin.initializeApp({
        credential: admin.credential.cert(credentials),
      });

      fastify.log.info('Firebase Admin initialized successfully');
    } catch (error) {
      fastify.log.error('Firebase Admin initialization error:', error);
      throw error;
    }
  }

  // Initialize Firestore with optimal settings
  const firestore = admin.firestore();
  
  // Configure Firestore settings for optimal performance
  firestore.settings({
    ignoreUndefinedProperties: true, 
    timestampsInSnapshots: true,
  });

  // Initialize GeoFirestore
  const GeoFirestore = geoFirestore.initializeApp(firestore);
  const FieldValue = admin.firestore.FieldValue;

  // Decorate Fastify instance with Firebase utilities
  fastify.decorate('firebase', {
    admin,
    firestore,
    GeoFirestore,
    FieldValue,
  });

  // Add onClose hook for graceful shutdown
//   fastify.addHook('onClose', async (instance) => {
//     try {
//       await admin.app().delete();
//       instance.log.info('Firebase Admin connection closed successfully');
//     } catch (error) {
//       instance.log.error('Error closing Firebase Admin connection:', error);
//     }
//   });

  fastify.log.info('Firebase plugin registered successfully');
}

// Export as Fastify plugin with fastify-plugin wrapper
export default fp(firebasePlugin, {
  name: 'firebase-plugin',
  fastify: '5.x',
});
