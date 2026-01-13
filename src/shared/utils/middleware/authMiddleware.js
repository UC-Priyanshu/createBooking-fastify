import { admin } from "../../../plugin/firebase.js";

const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  //   if (!authHeader || !authHeader.startsWith("Bearer ")) {
  //     return res
  //       .status(401)
  //       .json({ error: "Missing or invalid Authorization header" });
  //   }

  if (authHeader) {
    const idToken = authHeader.split("Bearer ")[1];

    try {
      const decoded = await admin.auth().verifyIdToken(idToken, true);

      // custom data added here
      req.user = {
        uid: decoded.uid,
        name: decoded?.name,
        phone_number: decoded?.phone_number,
      };
      return next();
    } catch (err) {
      console.error("Token verification failed", err);
      return res
        .status(401)
        .json({ error: "Unauthorized - invalid token", details: err.message });
    }
  } else {
    return next();
  }
};

export { verifyFirebaseToken };
