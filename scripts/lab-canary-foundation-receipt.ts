import {
  LAB_CANARY_FOUNDATION,
  labCanaryFoundationReceipt,
} from "../worker/src/labCanaryPolicy.js";

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  receipt: labCanaryFoundationReceipt(),
  foundation: LAB_CANARY_FOUNDATION,
}, null, 2));
