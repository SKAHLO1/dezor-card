'use client';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { env, isFirebaseConfigured } from '@/lib/env';

/**
 * Client Firebase init. Auth-only on the client — all Firestore reads/writes go through
 * the backend (which holds the Admin SDK), so the client only needs ID tokens.
 */

export const firebaseReady = isFirebaseConfigured();

const app = firebaseReady
  ? getApps().length
    ? getApp()
    : initializeApp({
        apiKey: env.firebase.apiKey,
        authDomain: env.firebase.authDomain,
        projectId: env.firebase.projectId,
        storageBucket: env.firebase.storageBucket,
        messagingSenderId: env.firebase.messagingSenderId,
        appId: env.firebase.appId,
      })
  : null;

export const auth = app ? getAuth(app) : null;
export const googleProvider = new GoogleAuthProvider();
