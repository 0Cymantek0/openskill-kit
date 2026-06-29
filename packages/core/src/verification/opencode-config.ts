import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { OPENCODE_CONFIG_SCHEMA } from "./opencode-config-schema.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });
// OpenCode schema references a large, fast-moving models.dev enum. Structural
// config validation must stay offline, so only satisfy that external ref here.
ajv.addSchema({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://models.dev/model-schema.json",
  $defs: {
    Model: {
      type: "string"
    }
  }
});
const validate = ajv.compile(OPENCODE_CONFIG_SCHEMA);

export interface OpenCodeConfigSchemaValidation {
  valid: boolean;
  errors: string[];
}

export function validateOpenCodeConfigSchema(config: unknown): OpenCodeConfigSchemaValidation {
  const valid = validate(config);
  if (valid) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: formatOpenCodeConfigSchemaErrors(validate.errors ?? [])
  };
}

function formatOpenCodeConfigSchemaErrors(errors: ErrorObject[]): string[] {
  return errors.map((error) => {
    const location = error.instancePath || "/";
    if (error.keyword === "additionalProperties" && isRecord(error.params) && typeof error.params.additionalProperty === "string") {
      return `${location} must not include unknown property ${error.params.additionalProperty}`;
    }
    return `${location} ${error.message ?? `failed ${error.keyword}`}`;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
