import { v7 as uuidV7 } from "uuid";

export type IdentifierGenerator = () => string;

export const generateUuidV7: IdentifierGenerator = () => uuidV7();
