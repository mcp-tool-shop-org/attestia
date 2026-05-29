<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/Attestia/readme.png" alt="Attestia" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/Attestia/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/Attestia/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/mcp-tool-shop-org/Attestia"><img src="https://codecov.io/gh/mcp-tool-shop-org/Attestia/graph/badge.svg" alt="codecov"></a>
  <a href="https://mcp-tool-shop-org.github.io/attestia/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page"></a>
  <a href="https://opensource.org/license/mit/"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License"></a>
</p>

<p align="center"><strong>Infraestructura de verdad financiera para el mundo descentralizado.</strong></p>

---

## Misión

Creemos que el dinero, sin importar dónde se encuentre o cómo se mueva, merece el mismo rigor que los sistemas que lo crearon. Los contratos inteligentes se ejecutan. Las blockchains registran. Pero nadie *certifica*.

Attestia es la capa que falta: gobernanza estructural, contabilidad determinista y intención aprobada por humanos, unificada en todas las cadenas, organizaciones e individuos.

No movemos su dinero. Demostramos lo que sucedió, limitamos lo que puede suceder y hacemos que el registro financiero sea inalterable.

### Por qué luchamos

- **Verdad por encima de la velocidad.** Cada evento financiero es de solo adición, reproducible y reconciliable. Si no se puede probar, no sucedió.
- **Los humanos aprueban; las máquinas verifican.** La IA asesora, los contratos inteligentes ejecutan, pero nada se mueve sin autorización humana explícita. Nunca.
- **Gobernanza estructural, no política.** No votamos sobre lo que es válido. Definimos invariantes que se cumplen incondicionalmente: la identidad es explícita, la línea de origen es ininterrumpida, el orden es determinista.
- **La intención no es la ejecución.** Declarar lo que se desea y hacerlo son actos separados con puertas separadas. La brecha entre ellos es donde reside la confianza.
- **Las cadenas son testigos, no autoridades.** XRPL certifica. Ethereum liquida. Pero la autoridad proviene de reglas estructurales, no del consenso de ninguna cadena.
- **La infraestructura sólida es la que gana.** El mundo no necesita otro protocolo DeFi. Necesita la capa de contabilidad subyacente, la infraestructura financiera que hace que todo lo demás sea confiable.

---

## Arquitectura

Attestia es tres sistemas, una verdad:

```
┌─────────────────────────────────────────────────────────┐
│                      ATTESTIA                           │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Personal   │  │     Org      │  │              │  │
│  │    Vault     │  │   Treasury   │  │   Registrum  │  │
│  │              │  │              │  │              │  │
│  │  Observe.    │  │  Distribute. │  │  Govern.     │  │
│  │  Budget.     │  │  Account.    │  │  Attest.     │  │
│  │  Allocate.   │  │  Reconcile.  │  │  Constrain.  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │           │
│         └────────────┬────┘                 │           │
│                      │                      │           │
│              ┌───────┴───────┐              │           │
│              │  Cross-System │◀─────────────┘           │
│              │ Reconciliation│                           │
│              └───────┬───────┘                           │
│                      │                                   │
│              ┌───────┴───────┐                           │
│              │ XRPL Witness  │                           │
│              │  (attestation)│                           │
│              └───────────────┘                           │
└─────────────────────────────────────────────────────────┘
```

| Sistema | Rol | Origen |
|--------|------|--------|
| **Personal Vault** | Observación de carteras multi-cadena, presupuesto en sobres, declaración de intención | Evolucionado de NextLedger |
| **Org Treasury** | Nómina determinista, distribuciones de DAO, financiación con doble autorización, libro mayor de doble entrada | Evolucionado de Payroll Engine |
| **Registrum** | Registrador estructural: 11 invariantes, validación con doble testigo, certificación XRPL | Sin cambios: capa constitucional |

---

## Pruébalo en 2 minutos

La forma más rápida de entender Attestia es ver cómo fluye un pago desde el principio hasta el final. La demostración interactiva ejecuta la secuencia completa de **Intención → Aprobación → Ejecución → Verificación → Certificación → Prueba**, de principio a fin, y calcula cada etapa en tiempo real utilizando los paquetes de dominio reales (coincidencia, hash, certificación al estilo XRPL, prueba Merkle), no una simulación.

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

Verás cómo un único pago de nómina se convierte en una prueba criptográfica verificable de forma independiente, paso a paso. Agrega `--fast` para omitir el ritmo y ejecutarlo instantáneamente: `pnpm demo --fast` (`pnpm demo --help` muestra todas las opciones).

---

## Patrón central

Cada interacción sigue un flujo:

```
Intent → Approve → Execute → Verify
```

1. **Intención** — Un usuario o sistema declara un resultado deseado.
2. **Aprobación** — El Registrum valida estructuralmente; un humano firma explícitamente.
3. **Ejecución** — Se envía la transacción en la cadena.
4. **Verificación** — La conciliación confirma; XRPL certifica el registro.

Ningún paso es opcional. Ningún paso se automatiza.

---

## Principios

| Principio | Implementación |
|-----------|---------------|
| Registros de solo adición | Sin ACTUALIZAR, sin BORRAR: solo nuevas entradas. |
| Fallo seguro | El desacuerdo detiene el sistema, nunca se corrige silenciosamente. |
| Reproducción determinista | Los mismos eventos producen el mismo estado, siempre. |
| IA solo como asesor | La IA puede analizar, advertir y sugerir, pero nunca aprobar, firmar ni ejecutar. |
| Observación multi-cadena | Ethereum, XRPL, Solana, L2: capa de lectura independiente de la cadena. |
| Identidad estructural. | Explícito, inmutable, único: no biométrico, sino constitucional. |

---

## Estado

14 paquetes, 2220 pruebas, 96.80% de cobertura, todo en verde. Compilación pública.

| Paquete | Pruebas | Propósito |
|---------|-------|---------|
| `@attestia/types` | 72 | Tipos de dominio compartidos (sin dependencias). |
| `@attestia/registrum` | 341 | Gobernanza constitucional: 11 invariantes, doble validación. |
| `@attestia/ledger` | 154 | Motor de registro único e inmutable. |
| `@attestia/chain-observer` | 278 | Observación de solo lectura en múltiples cadenas (EVM + XRPL + Solana + L2). |
| `@attestia/vault` | 75 | Bote personal: carteras, presupuestos, intenciones. |
| `@attestia/treasury` | 92 | Tesorería de la organización: nómina, distribuciones, mecanismos de financiación. |
| `@attestia/reconciler` | 81 | Emparejamiento 3D entre sistemas + certificación Registrum. |
| `@attestia/witness` | 278 | Certificación en la cadena XRPL, gobernanza multi-firma, reintento. |
| `@attestia/verify` | 242 | Verificación de repetición, evidencia de cumplimiento, aplicación de acuerdos de nivel de servicio (SLA). |
| `@attestia/event-store` | 226 | Persistencia de eventos inmutable, JSONL, cadena de hash, 34 tipos de eventos. |
| `@attestia/proof` | 75 | Árboles de Merkle, pruebas de inclusión, empaquetado de pruebas de certificación. |
| `@attestia/sdk` | 79 | SDK de cliente HTTP con tipado para consumidores externos. |
| `@attestia/node` | 227 | API REST Hono: 34 puntos finales, autenticación, multi-inquilino, API pública, cumplimiento. |
| `@attestia/demo` | — | Demostración interactiva de la línea de comandos: recorre todo el proceso de Attestia (privado, sin pruebas). |

### Desarrollo

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,220)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### Pruebas de integración con XRPL

Un nodo `rippled` independiente se ejecuta en Docker para pruebas de integración deterministas en la cadena, sin dependencia de red de pruebas, sin "faucet", cierre del registro en menos de un segundo.

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### Documentación

| Documento | Propósito |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | Descripción general y referencia completa del paquete. |
| [ROADMAP.md](ROADMAP.md) | Hoja de ruta del proyecto fase por fase. |
| [DESIGN.md](DESIGN.md) | Decisiones de arquitectura. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Gráfico de paquetes, flujos de datos, modelo de seguridad. |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | Pila de 5 capas, patrones de implementación, límites de confianza. |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | Integración de API con ejemplos de curl + uso del SDK. |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | Guía paso a paso para auditores. |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Análisis STRIDE por componente. |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | Mapeo de amenaza → control → archivo → prueba. |
| [SECURITY.md](SECURITY.md) | Política de divulgación responsable. |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | Lista de verificación de preparación para la adopción. |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | Resultados de pruebas de rendimiento registrados. |

---

## Alcance de seguridad y datos

- **Datos accedidos:** Lectura y escritura de entradas del libro mayor financiero, registros de certificación y pruebas criptográficas. Se conecta a nodos de blockchain (XRPL) cuando el módulo de testigo está activo.
- **Datos NO accedidos:** No hay telemetría. No hay almacenamiento de credenciales de usuario. No hay análisis de terceros.
- **Permisos requeridos:** Acceso de lectura/escritura a los directorios de datos locales. Acceso a la red solo para la certificación de blockchain. Consulte [THREAT_MODEL.md](THREAT_MODEL.md) para el análisis STRIDE completo.

## Cuadro de evaluación

| Puerta | Estado |
|------|--------|
| A. Línea de base de seguridad | PASADO |
| B. Manejo de errores | PASADO |
| C. Documentación para operadores | PASADO |
| D. Higiene de implementación | PASADO |
| E. Identidad | PASADO |

## Licencia

[MIT](LICENSE)

---

Creado por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
