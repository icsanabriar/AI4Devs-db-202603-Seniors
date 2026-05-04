/**
 * HTTP/API validation helpers for candidate payloads before persistence.
 * Rules mirror `schema.prisma` column lengths and OpenAPI constraints where applicable.
 */

const NAME_REGEX = /^[a-zA-ZñÑáéíóúÁÉÍÓÚ ]+$/;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
/** Matches Candidate.phone `@db.VarChar(32)` and OpenAPI candidate phone: printable tel chars only */
const PHONE_CHARS_REGEX = /^[+().\-\s\d]+$/;
const PHONE_MAX_LEN = 32;
/** Subscriber digits (E.164 max 15 excluding country-code nuance): keep local and intl payloads valid */
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ensures a person name is non-empty, within length bounds, and uses allowed letters/spaces
 * (including common Spanish accents).
 *
 * @param name - Candidate first or last name from the request body.
 * @throws When length or charset rules fail (`Invalid name`).
 */
export const validateName = (name: string) => {
    if (!name || name.length < 2 || name.length > 100 || !NAME_REGEX.test(name)) {
        throw new Error('Invalid name');
    }
};

/**
 * Validates email shape with a pragmatic RFC-ish pattern suitable for API input.
 *
 * @param email - Raw email string from the client.
 * @throws When empty or malformed (`Invalid email`).
 */
export const validateEmail = (email: string) => {
    if (!email || !EMAIL_REGEX.test(email)) {
        throw new Error('Invalid email');
    }
};

/**
 * Optional phone: empty string or `undefined`-coerced callers pass; otherwise enforces
 * `varchar(32)` length, allowed punctuation/whitespace charset, and digit count bounds.
 *
 * @param phone - Candidate phone; may be omitted (no-op).
 * @throws When present but violates length, charset, or digit-count rules (`Invalid phone`).
 */
export const validatePhone = (phone: string) => {
    if (!phone) {
        return;
    }
    if (
        phone.length > PHONE_MAX_LEN ||
        !PHONE_CHARS_REGEX.test(phone)
    ) {
        throw new Error('Invalid phone');
    }
    const digits = phone.replace(/\D/g, '');
    if (digits.length < PHONE_MIN_DIGITS || digits.length > PHONE_MAX_DIGITS) {
        throw new Error('Invalid phone');
    }
};

/**
 * ISO-style calendar date `YYYY-MM-DD` used for education/experience and API date fields.
 *
 * @param date - Date string from JSON (not a full ISO datetime).
 * @throws When missing or not matching the pattern (`Invalid date`).
 */
export const validateDate = (date: string) => {
    if (!date || !DATE_REGEX.test(date)) {
        throw new Error('Invalid date');
    }
};

/**
 * Optional address line: if provided, length must stay within the validator's limit
 * (stricter than DB `VARCHAR(255)` for historical API compatibility).
 *
 * @param address - Street or multi-line address; may be empty.
 * @throws When non-empty and longer than allowed (`Invalid address`).
 */
export const validateAddress = (address: string) => {
    if (address && address.length > 100) {
        throw new Error('Invalid address');
    }
};

/**
 * Validates a single education entry: institution/title lengths, ISO start date, optional end date.
 *
 * @param education - Loosely typed education object from multipart/JSON payloads.
 * @throws Domain-specific messages (`Invalid institution`, `Invalid title`, `Invalid end date`, etc.).
 */
export const validateEducation = (education: any) => {
    if (!education.institution || education.institution.length > 100) {
        throw new Error('Invalid institution');
    }

    if (!education.title || education.title.length > 100) {
        throw new Error('Invalid title');
    }

    validateDate(education.startDate);

    if (education.endDate && !DATE_REGEX.test(education.endDate)) {
        throw new Error('Invalid end date');
    }
};

/**
 * Validates a single work experience row: company/position lengths, optional description cap, dates.
 *
 * @param experience - Loosely typed experience object from the client.
 * @throws Domain-specific messages (`Invalid company`, `Invalid position`, `Invalid end date`, etc.).
 */
export const validateExperience = (experience: any) => {
    if (!experience.company || experience.company.length > 100) {
        throw new Error('Invalid company');
    }

    if (!experience.position || experience.position.length > 100) {
        throw new Error('Invalid position');
    }

    if (experience.description && experience.description.length > 200) {
        throw new Error('Invalid description');
    }

    validateDate(experience.startDate);

    if (experience.endDate && !DATE_REGEX.test(experience.endDate)) {
        throw new Error('Invalid end date');
    }
};

/**
 * Minimal structural check for resume metadata (`filePath`, `fileType` strings).
 *
 * @param cv - Object representing an uploaded CV reference in the payload.
 * @throws When not an object or required string fields are missing (`Invalid CV data`).
 */
export const validateCV = (cv: any) => {
    if (typeof cv !== 'object' || !cv.filePath || typeof cv.filePath !== 'string' || !cv.fileType || typeof cv.fileType !== 'string') {
        throw new Error('Invalid CV data');
    }
};

/**
 * Orchestrates candidate create validation: required identity/contact fields and nested collections.
 * When `data.id` is present, assumes an update path and skips mandatory-field checks (partial updates).
 *
 * @param data - Full or partial candidate DTO from controllers.
 * @throws From delegated validators on first failing field.
 */
export const validateCandidateData = (data: any) => {
    if (data.id) {
        // If id is provided, we are editing an existing candidate, so fields are not mandatory
        return;
    }

    validateName(data.firstName); 
    validateName(data.lastName); 
    validateEmail(data.email);
    validatePhone(data.phone);
    validateAddress(data.address);

    if (data.educations) {
        for (const education of data.educations) {
            validateEducation(education);
        }
    }

    if (data.workExperiences) {
        for (const experience of data.workExperiences) {
            validateExperience(experience);
        }
    }

    if (data.cv && Object.keys(data.cv).length > 0) {
        validateCV(data.cv);
    }
};