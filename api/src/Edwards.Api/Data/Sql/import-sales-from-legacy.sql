-- Copies today's sales history (product models, winning chances, visits, leads, quotations, targets) into Edwards 2.0.
-- Runs after import-from-legacy.sql. {{SOURCE}} is the source database on the same SQL Server.
--
-- Today's app keeps one quotation row per revision, all pointing at the lead. Here each quoted lead becomes one
-- opportunity; its quotation rows become revisions 1, 2, 3... and the newest row sets the opportunity's state.

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF EXISTS (SELECT 1 FROM dbo.Visits) OR EXISTS (SELECT 1 FROM dbo.ProductModels)
BEGIN
    SELECT 'Sales history' AS TableName, 0 AS RowsImported; -- already imported
    RETURN;
END

BEGIN TRANSACTION;

-- ---- Masters with extra fields ------------------------------------------------------------

SET IDENTITY_INSERT dbo.ProductModels ON;
INSERT dbo.ProductModels (Id, Name, Description, SortOrder, ProductRangeId, IsActive, CreatedAt, UpdatedAt)
SELECT m.ProductModelID, LTRIM(RTRIM(m.CompetitionMake)), m.Description, 0, m.ProductRangeID, m.IsActive, m.CreatedDate, m.LastModifiedDate
FROM [{{SOURCE}}].dbo.ProductModels m
JOIN dbo.ProductRanges r ON r.Id = m.ProductRangeID;
SET IDENTITY_INSERT dbo.ProductModels OFF;

SET IDENTITY_INSERT dbo.WinningChances ON;
INSERT dbo.WinningChances (Id, Name, Description, SortOrder, Percentage, IsActive, CreatedAt, UpdatedAt)
SELECT WinningChanceID, CONCAT(ChancePercentage, '%'), NULL, ChancePercentage, ChancePercentage, IsActive, CreatedDate, LastModifiedDate
FROM [{{SOURCE}}].dbo.WinningChances;
SET IDENTITY_INSERT dbo.WinningChances OFF;

-- ---- Visits ---------------------------------------------------------------------------------
-- 8 visits point at dealer engineers that no longer exist; they keep an empty engineer.

SET IDENTITY_INSERT dbo.Visits ON;
INSERT dbo.Visits (Id, VisitDate, VisitTypeId, CustomerId, DealerId, DealerUserId, ApplicationId, CustomerProduct, HasPotential,
                   LeadTypeId, ProductRangeId, ProductModelId, Remark, IsActive, CreatedAt, UpdatedAt)
SELECT v.VisitID, CAST(v.VisitDate AS date), v.VisitTypeID, v.AccountID, v.DealerID, u.Id, app.Id,
       NULLIF(LTRIM(RTRIM(v.CustProdModelID)), ''), CASE WHEN v.PotentialType = 'Yes' THEN 1 ELSE 0 END,
       lt.Id, pr.Id, pm.Id, NULLIF(LTRIM(RTRIM(v.VisitRemark)), ''), v.IsActive, v.CreatedDate, v.LastModifiedDate
FROM [{{SOURCE}}].dbo.Visits v
LEFT JOIN dbo.Users u ON u.LegacySource = 'DealerEngineers' AND u.LegacyId = v.DealerSEID
LEFT JOIN dbo.Applications app ON app.Id = v.ApplicationID
LEFT JOIN dbo.LeadTypes lt ON lt.Id = v.LeadTypeID
LEFT JOIN dbo.ProductRanges pr ON pr.Id = v.ProductRangeID
LEFT JOIN dbo.ProductModels pm ON pm.Id = v.ProductModelID;
SET IDENTITY_INSERT dbo.Visits OFF;

INSERT dbo.VisitCompetitors (VisitId, CompetitionMakeId, Model, Quantity, Working, Standby, PumpTechnologyId)
SELECT d.VisitID, cm.Id, NULLIF(LTRIM(RTRIM(d.CompetitionMake)), ''), d.CompetitionQty, d.NoofWorkingPumps, d.NoofStandByPumps, pt.Id
FROM [{{SOURCE}}].dbo.VisitDetails d
JOIN dbo.Visits v ON v.Id = d.VisitID
LEFT JOIN dbo.CompetitionMakes cm ON cm.Id = d.CompetitionMakeID
LEFT JOIN dbo.PumpTechnologies pt ON pt.Id = d.PumpTID
WHERE d.IsActive = 1;

-- ---- Leads ----------------------------------------------------------------------------------

SET IDENTITY_INSERT dbo.Leads ON;
INSERT dbo.Leads (Id, Name, CustomerId, Source, Status, VisitId, DealerId, DealerUserId, ProductRangeId, ProductModelId,
                  IsActive, CreatedAt, UpdatedAt)
SELECT l.LeadID, LTRIM(RTRIM(l.LeadName)), v.CustomerId, 0,
       CASE WHEN l.LeadStatus = 'Quote' THEN 2 ELSE 0 END,
       v.Id, v.DealerId, v.DealerUserId, pr.Id, pm.Id, l.IsActive, l.CreatedDate, l.LastModifiedDate
FROM [{{SOURCE}}].dbo.Leads l
JOIN dbo.Visits v ON v.Id = l.VisitID
LEFT JOIN dbo.ProductRanges pr ON pr.Id = l.ProductRangeID
LEFT JOIN dbo.ProductModels pm ON pm.Id = l.ProductModelID;
SET IDENTITY_INSERT dbo.Leads OFF;

UPDATE v SET LeadId = l.Id
FROM dbo.Visits v
JOIN [{{SOURCE}}].dbo.Visits sv ON sv.VisitID = v.Id
JOIN dbo.Leads l ON l.Id = sv.LeadID;

-- ---- Opportunities and quotations -----------------------------------------------------------

SELECT q.*, os.OpportunityStatus AS StatusName,
       ROW_NUMBER() OVER (PARTITION BY q.LeadID ORDER BY q.QuotationID) AS Revision,
       ROW_NUMBER() OVER (PARTITION BY q.LeadID ORDER BY q.QuotationID DESC) AS NewestFirst
INTO #quotes
FROM [{{SOURCE}}].dbo.Quotations q
JOIN dbo.Leads l ON l.Id = q.LeadID
LEFT JOIN [{{SOURCE}}].dbo.OpportunityStatus os ON os.OpportunityStatusID = q.OpportunityStatusID;

INSERT dbo.Opportunities (Name, Type, Source, Stage, CustomerId, LeadId, DealerId, DealerUserId, DealerAccepted,
                          SalesPhaseId, WinningChanceId, OpportunityModeId, ExpectedCloseDate, Value, CompetitionPrice,
                          WinningReasonId, LosingReasonId, ClosedDate, FollowUpOverdueAlerted, IsActive, CreatedAt, UpdatedAt)
SELECT LEFT(COALESCE(NULLIF(LTRIM(RTRIM(q.OpportunityName)), ''), l.Name), 250), 0, 0,
       CASE UPPER(LTRIM(RTRIM(q.StatusName))) WHEN 'WON' THEN 1 WHEN 'LOST' THEN 2 WHEN 'POSTPONED' THEN 3
            WHEN 'PROJECT DROPPED/SHELVED' THEN 4 ELSE 0 END,
       l.CustomerId, l.Id, l.DealerId, l.DealerUserId, 1,
       sp.Id, wc.Id, om.Id, CAST(q.OppExpectedDate AS date), q.NetValue, q.CompetitionPrice,
       wr.Id, lr.Id,
       CASE WHEN UPPER(LTRIM(RTRIM(q.StatusName))) IN ('WON', 'LOST') THEN CAST(q.OderWonDate AS date) END,
       1, q.IsActive, first.CreatedDate, q.LastModifiedDate
FROM #quotes q
JOIN #quotes first ON first.LeadID = q.LeadID AND first.Revision = 1
JOIN dbo.Leads l ON l.Id = q.LeadID
LEFT JOIN dbo.SalesPhases sp ON sp.Id = q.SalesPhaseID
LEFT JOIN dbo.WinningChances wc ON wc.Id = q.WinningChanceID
LEFT JOIN dbo.OpportunityModes om ON om.Id = q.OpportunityModeID
LEFT JOIN dbo.WinningReasons wr ON wr.Id = q.WinningReasonID
LEFT JOIN dbo.LosingReasons lr ON lr.Id = q.LossingReasonID
WHERE q.NewestFirst = 1 AND l.DealerId IS NOT NULL;

UPDATE l SET OpportunityId = o.Id, Status = 2
FROM dbo.Leads l
JOIN dbo.Opportunities o ON o.LeadId = l.Id;

SET IDENTITY_INSERT dbo.Quotations ON;
INSERT dbo.Quotations (Id, OpportunityId, Revision, Number, QuoteDate, Status, Total, Remark, SubmittedAt, IsActive, CreatedAt, UpdatedAt)
SELECT q.QuotationID, o.Id, q.Revision, CONCAT('Q', RIGHT(CONCAT('00000', o.Id), 5), '-R', q.Revision), CAST(q.QuotationDate AS date),
       CASE WHEN q.NewestFirst > 1 THEN 2
            WHEN o.Stage = 1 THEN 3
            WHEN o.Stage = 2 THEN 4
            ELSE 1 END,
       q.NetValue, NULLIF(CONCAT('Reference in today''s system: ', q.RQuotationID), 'Reference in today''s system: '),
       q.QuotationDate, q.IsActive, q.CreatedDate, q.LastModifiedDate
FROM #quotes q
JOIN dbo.Opportunities o ON o.LeadId = q.LeadID;
SET IDENTITY_INSERT dbo.Quotations OFF;

INSERT dbo.QuotationLines (QuotationId, Type, ProductRangeId, ProductModelId, Description, Quantity, UnitPrice, LineTotal)
SELECT d.QuotationID, 0, pr.Id, pm.Id, NULL, d.Qty,
       CASE WHEN d.Qty > 0 THEN ROUND(d.NetValue / d.Qty, 2) ELSE d.NetValue END, d.NetValue
FROM [{{SOURCE}}].dbo.QuotaionDetails d
JOIN dbo.Quotations q ON q.Id = d.QuotationID
LEFT JOIN dbo.ProductRanges pr ON pr.Id = d.ProductRangeID
LEFT JOIN dbo.ProductModels pm ON pm.Id = d.ProductModelID
WHERE d.IsActive = 1;

-- ---- Dealer targets (today's TargetYear is kept as the fiscal year) -------------------------

INSERT dbo.DealerTargets (DealerId, FiscalYear, TargetValue, IsActive, CreatedAt, UpdatedAt)
SELECT t.DealerID, t.TargetYear, t.TargetValue, t.IsActive, t.CreatedDate, t.LastModifiedDate
FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY DealerID, TargetYear ORDER BY TargetID DESC) AS n
      FROM [{{SOURCE}}].dbo.DealerTarget) t
JOIN dbo.Dealers d ON d.Id = t.DealerID
WHERE t.n = 1;

INSERT dbo.DealerQuantityTargets (DealerId, FiscalYear, ProductRangeId, TargetQuantity, TargetValue, IsActive, CreatedAt, UpdatedAt)
SELECT t.DealerID, t.TargetYear, t.ProductRangeID, t.TargetQty, t.TargetValue, t.IsActive, t.CreatedDate, t.LastModifiedDate
FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY DealerID, TargetYear, ProductRangeID ORDER BY QtID DESC) AS n
      FROM [{{SOURCE}}].dbo.DealerQuantityTarget) t
JOIN dbo.Dealers d ON d.Id = t.DealerID
JOIN dbo.ProductRanges r ON r.Id = t.ProductRangeID
WHERE t.n = 1;

COMMIT TRANSACTION;

SELECT 'Product models' AS TableName, COUNT(*) AS RowsImported FROM dbo.ProductModels
UNION ALL SELECT 'Winning chances', COUNT(*) FROM dbo.WinningChances
UNION ALL SELECT 'Visits', COUNT(*) FROM dbo.Visits
UNION ALL SELECT 'Competitor lines', COUNT(*) FROM dbo.VisitCompetitors
UNION ALL SELECT 'Leads', COUNT(*) FROM dbo.Leads
UNION ALL SELECT 'Opportunities', COUNT(*) FROM dbo.Opportunities
UNION ALL SELECT 'Quotations', COUNT(*) FROM dbo.Quotations
UNION ALL SELECT 'Quotation lines', COUNT(*) FROM dbo.QuotationLines
UNION ALL SELECT 'Value targets', COUNT(*) FROM dbo.DealerTargets
UNION ALL SELECT 'Quantity targets', COUNT(*) FROM dbo.DealerQuantityTargets;
