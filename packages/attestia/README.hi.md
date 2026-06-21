<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.md">English</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/Attestia/readme.png" alt="Attestia" width="400">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mcptoolshop/attestia"><img src="https://img.shields.io/npm/v/@mcptoolshop/attestia" alt="npm version"></a>
  <a href="https://github.com/mcp-tool-shop-org/attestia/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/attestia/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://opensource.org/license/mit/"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License"></a>
</p>

<p align="center"><strong>विकेंद्रीकृत दुनिया के लिए वित्तीय सत्य का बुनियादी ढांचा – पूरी एटटेस्टिया लाइब्रेरी एक पैकेज में।</strong></p>

संरचनात्मक शासन, नियतात्मक लेखांकन और मानव द्वारा अनुमोदित इरादा – श्रृंखलाओं, संगठनों और व्यक्तियों में एकीकृत। एटटेस्टिया आपके पैसे को स्थानांतरित नहीं करता; यह साबित करता है कि क्या हुआ, यह सीमित करता है कि क्या हो सकता है, और वित्तीय रिकॉर्ड को अटूट बनाता है।

यह पैकेज पूरी एटटेस्टिया लाइब्रेरी को एक ही इंस्टॉलेशन (ईएसएम) में समेटता है। आंतरिक `@attestia/*` वर्कस्पेस पैकेज इनलाइन किए गए हैं – प्रबंधित करने के लिए कोई पैकेज स्प्राउल नहीं है; तृतीय-पक्ष रनटाइम निर्भरताएं (xrpl, viem, @solana/web3.js, json-canonicalize, ripple-keypairs) सामान्य रूप से हल होती हैं।

## इंस्टॉल करें

```bash
npm install @mcptoolshop/attestia
```

> **केवल ईएसएम** (नोड ≥ 22)। GitHub एक्शन ओआईडीसी विश्वसनीय प्रकाशन के माध्यम से [एनपीएम प्रोवेनैंस](https://docs.npmjs.com/generating-provenance-statements) के साथ प्रकाशित।

## उपयोग

रूट से एक डोमेन को **नेमस्पेस** के रूप में आयात करें:

```ts
import { ledger, proof, registrum } from "@mcptoolshop/attestia";

const total = ledger.addMoney(
  { amount: "100.00", currency: "USD", decimals: 2 },
  { amount: "50.00", currency: "USD", decimals: 2 },
);

const tree = proof.MerkleTree.build([/* sha-256 leaf hashes */]);
```

…या किसी **सबपाथ** से फ्लैट प्रतीकों को आयात करें:

```ts
import { MerkleTree, verifyAttestationProof } from "@mcptoolshop/attestia/proof";
import { StructuralRegistrar } from "@mcptoolshop/attestia/registrum";
import { JsonlEventStore } from "@mcptoolshop/attestia/event-store";
import { AttestiaClient } from "@mcptoolshop/attestia/sdk";
```

## सबपाथ

| सबपाथ | यह क्या है |
|---------|-----------|
| `@mcptoolshop/attestia` | रूट बैरल – प्रत्येक डोमेन एक नेमस्पेस के रूप में |
| `…/types` | साझा डोमेन प्रकार (धन, आईडी, ब्रांडेड प्रिमिटिव) |
| `…/ledger` | केवल-अतिरिक्त डबल-एंट्री इंजन + नियतात्मक धन गणित |
| `…/registrum` | संवैधानिक रजिस्ट्रार – 11 अपरिवर्तनीयताएं, दोहरे गवाह |
| `…/event-store` | केवल-अतिरिक्त इवेंट दृढ़ता – JSONL, हैश श्रृंखला |
| `…/proof` | मर्केल ट्री (RFC 6962), समावेश + सत्यापन प्रमाण |
| `…/vault` | व्यक्तिगत तिजोरी – पोर्टफोलियो, बजट, इरादे |
| `…/treasury` | संगठन का खजाना – वेतन, वितरण, फंडिंग गेट्स |
| `…/reconciler` | क्रॉस-सिस्टम मिलान + रजिस्ट्रम सत्यापन |
| `…/chain-observer` | बहु-श्रृंखला केवल-पढ़ने योग्य अवलोकन (ईवीएम, एक्सआरपीएल, सोलाना, एल2) |
| `…/witness` | एक्सआरपीएल ऑन-चेन सत्यापन, बहु-हस्ताक्षर शासन |
| `…/verify` | पुन: प्ले सत्यापन, अनुपालन प्रमाण, एसएलए |
| `…/sdk` | एटटेस्टिया आरईएसटी एपीआई के लिए टाइप किया गया एचटीटीपी क्लाइंट |

## मुख्य पैटर्न

प्रत्येक इंटरैक्शन एक प्रवाह का पालन करता है, और कोई भी चरण वैकल्पिक नहीं है:

```
Intent → Approve → Execute → Verify
```

## दस्तावेज़

पूर्ण हैंडबुक, आर्किटेक्चर, खतरे का मॉडल और सत्यापन मार्गदर्शिका: **<https://mcp-tool-shop-org.github.io/attestia/>** · स्रोत: **<https://github.com/mcp-tool-shop-org/attestia>**

## लाइसेंस

[एमआईटी](LICENSE) – [एमसीपी टूल शॉप](https://mcp-tool-shop.github.io/) द्वारा निर्मित।
