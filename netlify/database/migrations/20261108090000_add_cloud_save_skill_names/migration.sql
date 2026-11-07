-- Cloud save: each saved skill keeps its SKILL.md name (NFC, lower case), so two different skills in
-- same-name folders never save over each other. Null for skills saved before names were kept.
ALTER TABLE cloud_saved_skills ADD COLUMN skill_name text;
