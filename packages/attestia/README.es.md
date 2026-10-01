<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/Attestia/readme.png" alt="Attestia" width="400">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mcptoolshop/attestia"><img src="https://img.shields.io/npm/v/@mcptoolshop/attestia" alt="npm version"></a>
  <a href="https://github.com/mcp-tool-shop-org/attestia/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/attestia/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://opensource.org/license/mit/"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License"></a>
</p>

<p align="center"><strong>Prueba de que un evento, una transacción o una transición de estado tuvo lugar, vinculada a una cadena. Toda la biblioteca en un solo paquete.</strong></p>

El ámbito de este paquete es la verdad financiera: bóveda personal, tesorería de la organización y registro. Gobernanza estructural, contabilidad determinista e intención aprobada por humanos en todas las cadenas, organizaciones e individuos. Attestia no mueve su dinero. Demuestra lo que sucedió, restringe lo que puede suceder y hace que el registro financiero sea inquebrantable.

Cognate utiliza el almacén de eventos y las pruebas de Merkle de este paquete para la gobernanza de la IA. RepoMesh es un libro mayor independiente y no utiliza este árbol de Merkle.

Este paquete incluye toda la superficie de la biblioteca Attestia en una sola instalación (ESM). Los paquetes internos del espacio de trabajo `@attestia/*` se incluyen en línea; no hay que gestionar la proliferación de paquetes; las dependencias de tiempo de ejecución de terceros (xrpl, viem, @solana/web3.js, json-canonicalize, ripple-keypairs) se resuelven normalmente.

## Instalación

```bash
npm install @mcptoolshop/attestia
```

> **Solo ESM** (Node ≥ 22). Publicado con [npm provenance](https://docs.npmjs.com/generating-provenance-statements) a través de GitHub Actions OIDC Trusted Publishing.

## Uso

Importe un dominio como un **espacio de nombres** desde la raíz:

```ts
import { ledger, proof, registrum } from "@mcptoolshop/attestia";

const total = ledger.addMoney(
  { amount: "100.00", currency: "USD", decimals: 2 },
  { amount: "50.00", currency: "USD", decimals: 2 },
);

const tree = proof.MerkleTree.build([/* sha-256 leaf hashes */]);
```

…o importe símbolos planos desde una **subruta**:

```ts
import { MerkleTree, verifyAttestationProof } from "@mcptoolshop/attestia/proof";
import { StructuralRegistrar } from "@mcptoolshop/attestia/registrum";
import { JsonlEventStore } from "@mcptoolshop/attestia/event-store";
import { AttestiaClient } from "@mcptoolshop/attestia/sdk";
```

## Subrutas

| Subruta | Qué es |
|---------|-----------|
| `@mcptoolshop/attestia` | Archivo raíz: cada dominio como un espacio de nombres |
| `…/types` | Tipos de dominio compartidos (dinero, identificadores, primitivas de marca) |
| `…/ledger` | Motor de doble entrada de solo anexión + matemáticas deterministas del dinero |
| `…/registrum` | Registrador constitucional: 11 invariantes, testigo dual |
| `…/event-store` | Persistencia de eventos de solo anexión: JSONL, cadena hash |
| `…/proof` | Árboles de Merkle (RFC 6962), pruebas de inclusión + atestación |
| `…/vault` | Bóveda personal: carteras, presupuestos, intenciones |
| `…/treasury` | Tesorería de la organización: nómina, distribuciones, puertas de financiación |
| `…/reconciler` | Coincidencia entre sistemas + atestación de Registrum |
| `…/chain-observer` | Observación de solo lectura entre cadenas (EVM, XRPL, Solana, L2) |
| `…/witness` | Atestación en cadena de XRPL, gobernanza multi-firma |
| `…/verify` | Verificación de reproducción, evidencia de cumplimiento, SLA |
| `…/sdk` | Cliente HTTP con tipo para la API REST de Attestia |

## Patrón principal

Cada interacción sigue un flujo, y ningún paso es opcional:

```
Intent → Approve → Execute → Verify
```

## Documentación

Manual completo, arquitectura, modelo de amenazas y guía de verificación: **<https://mcp-tool-shop-org.github.io/attestia/>** · Fuente: **<https://github.com/mcp-tool-shop-org/attestia>**

## Licencia

[MIT](LICENSE) — creado por [MCP Tool Shop](https://mcp-tool-shop.github.io/).
