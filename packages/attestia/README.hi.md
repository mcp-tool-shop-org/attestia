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

<p align="center"><strong>यह प्रमाण कि कोई घटना, लेनदेन या स्थिति परिवर्तन हुआ, और यह किसी श्रृंखला से जुड़ा हुआ है। पूरी लाइब्रेरी एक ही पैकेज में।</strong></p>

इस पैकेज का मुख्य क्षेत्र वित्तीय पारदर्शिता है: व्यक्तिगत तिजोरी, संगठनात्मक कोष और रजिस्टर। इसमें संरचनात्मक शासन, निश्चित लेखांकन और विभिन्न श्रृंखलाओं, संगठनों और व्यक्तियों में मानवीय अनुमोदन पर आधारित इरादे शामिल हैं। एटटेस्टिया आपके धन को स्थानांतरित नहीं करता है। यह साबित करता है कि क्या हुआ, यह निर्धारित करता है कि क्या हो सकता है, और वित्तीय रिकॉर्ड को अटूट बनाता है।

कॉग्नेट इस पैकेज में एआई शासन के लिए इवेंट स्टोर और मर्कल प्रूफ का उपयोग करता है। रेपोमेश एक अलग रिलीज़ लेज़र है और यह मर्कल ट्री का उपयोग नहीं करता है।

यह पैकेज संपूर्ण एटटेस्टिया लाइब्रेरी को एक ही इंस्टॉलेशन (ईएसएम) में समेटता है। आंतरिक `@attestia/*` वर्कस्पेस पैकेज को सीधे शामिल किया गया है—इसे प्रबंधित करने के लिए किसी भी पैकेज के विस्तार की आवश्यकता नहीं है; तृतीय-पक्ष रनटाइम निर्भरताएँ (एक्सआरपीएल, वीईएम, @सोलाना/वेब3.जेएस, जेएसओएन-कैनोनिकलाइज़, रिपल-कीपेयर्स) सामान्य रूप से हल हो जाती हैं।

## स्थापित करें

```bash
npm install @mcptoolshop/attestia
```

> **केवल ईएसएम** (नोड ≥ 22)। इसे गिटहब एक्शन ओआईडीसी विश्वसनीय प्रकाशन के माध्यम से [एनपीएम प्रोवेनैंस](https://docs.npmjs.com/generating-provenance-statements) के साथ प्रकाशित किया गया है।

## उपयोग

मुख्य डोमेन से एक **नेमस्पेस** के रूप में डोमेन आयात करें:

```ts
import { ledger, proof, registrum } from "@mcptoolshop/attestia";

const total = ledger.addMoney(
  { amount: "100.00", currency: "USD", decimals: 2 },
  { amount: "50.00", currency: "USD", decimals: 2 },
);

const tree = proof.MerkleTree.build([/* sha-256 leaf hashes */]);
```

…या किसी **उप-पथ** से सपाट प्रतीकों को आयात करें:

```ts
import { MerkleTree, verifyAttestationProof } from "@mcptoolshop/attestia/proof";
import { StructuralRegistrar } from "@mcptoolshop/attestia/registrum";
import { JsonlEventStore } from "@mcptoolshop/attestia/event-store";
import { AttestiaClient } from "@mcptoolshop/attestia/sdk";
```

## उप-मार्ग

| उप-पथ | यह क्या है। |
|---------|-----------|
| `@mcptoolshop/attestia` | रूट बैरल – प्रत्येक डोमेन एक नेमस्पेस के रूप में। |
| `…/types` | साझा डोमेन प्रकार (धन, पहचानकर्ता, ब्रांडेड मूलभूत तत्व) |
| `…/ledger` | केवल जोड़ने की अनुमति देने वाला दोहरे प्रविष्टि वाला इंजन + निश्चित गणितीय गणना |
| `…/registrum` | संवैधानिक रजिस्ट्रार — 11 अपरिवर्तनीय तत्व, दोहरे गवाह |
| `…/event-store` | केवल जोड़ने की अनुमति वाली घटना की स्थायीता – JSONL, हैश श्रृंखला। |
| `…/proof` | मर्कल ट्री (आरएफसी 6962), समावेशन + सत्यापन प्रमाण |
| `…/vault` | व्यक्तिगत तिजोरी – पोर्टफोलियो, बजट, इरादे। |
| `…/treasury` | संगठन का खजाना – वेतन, वितरण, वित्तपोषण प्रक्रियाएँ |
| `…/reconciler` | विभिन्न प्रणालियों में मिलान + रजिस्ट्रम द्वारा सत्यापन |
| `…/chain-observer` | बहु-श्रृंखला, केवल-पढ़ने योग्य अवलोकन (ईवीएम, एक्सआरपीएल, सोलाना, एल2) |
| `…/witness` | एक्सआरपीएल ऑन-चेन सत्यापन, बहु-हस्ताक्षर शासन |
| `…/verify` | पुनः प्ले सत्यापन, अनुपालन प्रमाण, सेवा स्तर समझौता। |
| `…/sdk` | एटटेस्टिया रेस्ट एपीआई के लिए टाइप किया गया एचटीटीपी क्लाइंट। |

## मुख्य पैटर्न

हर बातचीत एक निश्चित क्रम का पालन करती है, और इसमें कोई भी चरण वैकल्पिक नहीं होता:

```
Intent → Approve → Execute → Verify
```

## दस्तावेज़ीकरण

पूर्ण निर्देशिका, आर्किटेक्चर, खतरे का मॉडल और सत्यापन मार्गदर्शिका: **<https://mcp-tool-shop-org.github.io/attestia/>** · स्रोत: **<https://github.com/mcp-tool-shop-org/attestia>**

## लाइसेंस

[एमआईटी] लाइसेंस – [एमसीपी टूल शॉप] द्वारा निर्मित।
