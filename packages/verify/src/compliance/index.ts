/**
 * @attestia/verify — Compliance module.
 *
 * Framework mappings and evidence generation for regulatory compliance.
 */

// Types
export type {
  ComplianceFramework,
  EvidenceType,
  EvidenceClass,
  ControlStatus,
  ControlMapping,
  EvaluatedControl,
  ComplianceReport,
} from "./types.js";

// SOC 2
export { SOC2_FRAMEWORK, SOC2_MAPPINGS } from "./soc2-mapping.js";

// ISO 27001
export { ISO27001_FRAMEWORK, ISO27001_MAPPINGS } from "./iso27001-mapping.js";

// Evidence generator
export { generateComplianceEvidence } from "./evidence-generator.js";
