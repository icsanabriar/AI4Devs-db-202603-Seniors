-- `Position.interviewFlowId` is already unique via FK + `Position_interviewFlowId_key`; this
-- non-unique index was redundant and is removed to reduce write amplification.

-- DropIndex
DROP INDEX "Position_interviewFlowId_idx";
