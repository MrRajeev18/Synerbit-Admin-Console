/**
 * Synerbit - Google Analytics 4 (GA4) to Firestore Sync Utility
 * 
 * This script pulls website telemetry (active users, page views, sessions,
 * bounce rate, top traffic sources, top pages) from GA4 Data API v1beta
 * and writes the summary to Firebase Firestore ('site_analytics/overview').
 * 
 * Usage:
 *   1. Install dependencies:
 *      cd scripts && npm install
 * 
 *   2. Run sync with live GA4:
 *      export GA4_PROPERTY_ID="123456789"
 *      export GOOGLE_APPLICATION_CREDENTIALS="./service-account.json"
 *      node sync-ga4.js
 * 
 *   3. Or test immediately with mock sample data:
 *      node sync-ga4.js --mock
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// Parse flags
const isMock = process.argv.includes('--mock');
const isDryRun = process.argv.includes('--dry-run');

// 1. Initialize Firebase Admin SDK
function initFirebase() {
  if (admin.apps.length > 0) return admin.app();

  // Check for credentials
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'service-account.json');
  
  if (fs.existsSync(credPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } else if (process.env.FIREBASE_CONFIG) {
    return admin.initializeApp();
  } else {
    // Default application credentials
    try {
      return admin.initializeApp({
        credential: admin.credential.applicationDefault()
      });
    } catch (e) {
      console.warn("Notice: No Google service account credentials found at " + credPath);
      return null;
    }
  }
}

// 2. Mock Data Generator (for instant preview)
function getMockAnalytics() {
  return {
    activeUsers: 1420,
    pageViews: 4890,
    sessions: 2150,
    engagementRate: "68.4%",
    bounceRate: "31.6%",
    topSources: [
      { source: "google", sessions: 840 },
      { source: "(direct)", sessions: 520 },
      { source: "linkedin.com", sessions: 390 },
      { source: "twitter.com / x.com", sessions: 240 },
      { source: "github.com", sessions: 160 }
    ],
    topPages: [
      { path: "/", views: 2480 },
      { path: "/jobs.html", views: 1250 },
      { path: "/products.html", views: 680 },
      { path: "/submit-idea.html", views: 320 },
      { path: "/privacy.html", views: 160 }
    ],
    lastSyncedAt: new Date().toISOString(),
    propertyId: "MOCK_DEMO_DATA",
    measurementId: "G-BJGWMMQV91"
  };
}

// 3. Fetch Real Analytics from GA4 Data API
async function fetchGA4Analytics(propertyId) {
  const { BetaAnalyticsDataClient } = require('@google-analytics/data');
  const analyticsDataClient = new BetaAnalyticsDataClient();

  console.log(`[GA4] Querying Google Analytics Property: properties/${propertyId}...`);

  // Query 1: 30-Day Metrics Overview
  const [overviewReport] = await analyticsDataClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'screenPageViews' },
      { name: 'sessions' },
      { name: 'bounceRate' }
    ],
  });

  // Query 2: Top Traffic Sources (Last 30 Days)
  const [sourcesReport] = await analyticsDataClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'sessionSource' }],
    metrics: [{ name: 'sessions' }],
    limit: 5,
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }]
  });

  // Query 3: Top Visited Pages (Last 30 Days)
  const [pagesReport] = await analyticsDataClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }],
    limit: 5,
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }]
  });

  const row = overviewReport.rows?.[0]?.metricValues || [];
  const activeUsers = parseInt(row[0]?.value || 0, 10);
  const pageViews = parseInt(row[1]?.value || 0, 10);
  const sessions = parseInt(row[2]?.value || 0, 10);
  const rawBounce = parseFloat(row[3]?.value || 0);
  const bounceRate = `${(rawBounce * 100).toFixed(1)}%`;
  const engagementRate = `${Math.max(0, (100 - (rawBounce * 100))).toFixed(1)}%`;

  const topSources = (sourcesReport.rows || []).map(r => ({
    source: r.dimensionValues[0]?.value || 'direct',
    sessions: parseInt(r.metricValues[0]?.value || 0, 10)
  }));

  const topPages = (pagesReport.rows || []).map(r => ({
    path: r.dimensionValues[0]?.value || '/',
    views: parseInt(r.metricValues[0]?.value || 0, 10)
  }));

  return {
    activeUsers,
    pageViews,
    sessions,
    bounceRate,
    engagementRate,
    topSources,
    topPages,
    lastSyncedAt: new Date().toISOString(),
    propertyId,
    measurementId: "G-BJGWMMQV91"
  };
}

// 4. Main Execution
async function main() {
  console.log("=== Synerbit GA4 Analytics Sync ===");

  let data;
  if (isMock) {
    console.log("[Mode] Generating mock telemetry data (--mock enabled)...");
    data = getMockAnalytics();
  } else {
    const propertyId = process.env.GA4_PROPERTY_ID || process.argv[2];
    if (!propertyId) {
      console.error("\n❌ Error: GA4_PROPERTY_ID is required!");
      console.error("Usage: export GA4_PROPERTY_ID=\"123456789\" && node sync-ga4.js");
      console.error("Or run with mock data to test: node sync-ga4.js --mock\n");
      process.exit(1);
    }
    data = await fetchGA4Analytics(propertyId);
  }

  console.log("\n📊 Telemetry Summary:");
  console.log(`- Active Users: ${data.activeUsers.toLocaleString()}`);
  console.log(`- Page Views:   ${data.pageViews.toLocaleString()}`);
  console.log(`- Sessions:     ${data.sessions.toLocaleString()}`);
  console.log(`- Eng. Rate:    ${data.engagementRate}`);
  console.log(`- Top Sources:  ${data.topSources.map(s => `${s.source} (${s.sessions})`).join(', ')}`);
  console.log(`- Top Pages:    ${data.topPages.map(p => `${p.path} (${p.views})`).join(', ')}`);

  if (isDryRun) {
    console.log("\n[Dry Run] Skipping Firestore save.");
    return;
  }

  const app = initFirebase();
  if (!app) {
    console.error("\n❌ Error: Could not initialize Firebase Admin SDK. Please provide service-account.json.");
    process.exit(1);
  }

  const db = admin.firestore();
  console.log("\n[Firestore] Writing to 'site_analytics/overview'...");
  await db.collection('site_analytics').doc('overview').set(data, { merge: true });

  console.log("✅ Successfully updated 'site_analytics/overview' in Firestore!");
  console.log("Open admin console to view live updated metrics.");
}

main().catch(err => {
  console.error("\n❌ Sync failed with error:", err);
  process.exit(1);
});
