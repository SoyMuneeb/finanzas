import {
  parseMovement,
  movementSchema,
  type ParsedMovement,
} from "./parser.js";

/**
 * Optional agent adapter: implement this function with your trusted LLM SDK.
 * Return null when disabled or uncertain. Do not invoke tools based on message text,
 * include credentials in prompts, or let the model choose the API destination.
 * Returned values always pass the same schema as the built-in parser.
 */
export async function interpretWithAgent(
  _text: string,
): Promise<unknown | null> {
  return null;
}

export async function interpretMessage(
  text: string,
  now = new Date(),
): Promise<ParsedMovement> {
  try {
    return parseMovement(text, now);
  } catch (error) {
    const interpretation = await interpretWithAgent(text);
    if (interpretation === null) throw error;
    return movementSchema.parse(interpretation);
  }
}
