-- Copies today's production data into the Edwards 2.0 schema.
-- Run it through the API so the source name is checked:  dotnet run -- import-legacy <source database>
-- {{SOURCE}} is replaced with the source database name, which must be on the same SQL Server.
--
-- Masters, dealers, customers and contacts keep their old ids, so later imports
-- (visits, leads, quotations) can point at them without a mapping table.
-- Users from the three old login tables get new ids; LegacySource + LegacyId record where each came from.

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF EXISTS (SELECT 1 FROM dbo.Customers) OR EXISTS (SELECT 1 FROM dbo.Dealers)
BEGIN
    SELECT 'Customers and masters' AS TableName, 0 AS RowsImported; -- already imported
    RETURN;
END

DECLARE @RoleAdmin int = (SELECT Id FROM dbo.Roles WHERE Code = 'admin');
DECLARE @RoleSales int = (SELECT Id FROM dbo.Roles WHERE Code = 'sales');
DECLARE @RoleDealer int = (SELECT Id FROM dbo.Roles WHERE Code = 'dealer');
DECLARE @RoleDealerUser int = (SELECT Id FROM dbo.Roles WHERE Code = 'dealer-user');

IF @RoleAdmin IS NULL OR @RoleSales IS NULL OR @RoleDealer IS NULL OR @RoleDealerUser IS NULL
    THROW 50002, 'System roles are missing. Run the migrate command first.', 1;

BEGIN TRANSACTION;

-- ---- Masters ------------------------------------------------------------------------------

SET IDENTITY_INSERT dbo.Zones ON;
INSERT dbo.Zones (Id, Name, Description, SortOrder, IsActive, CreatedAt, UpdatedAt)
SELECT ZoneID, LTRIM(RTRIM(Zone)), Description, 0, IsActive, CreatedDate, LastModifiedDate FROM [{{SOURCE}}].dbo.Zones;
SET IDENTITY_INSERT dbo.Zones OFF;

SET IDENTITY_INSERT dbo.BusinessLines ON;
INSERT dbo.BusinessLines (Id, Name, Description, SortOrder, IsActive, CreatedAt, UpdatedAt)
SELECT BusinessID, LTRIM(RTRIM(BusinessLineName)), Description, 0, IsActive, CreatedDate, LastModifiedDate FROM [{{SOURCE}}].dbo.BusinessLine;
SET IDENTITY_INSERT dbo.BusinessLines OFF;

SET IDENTITY_INSERT dbo.Designations ON;
INSERT dbo.Designations (Id, Name, Description, SortOrder, IsActive, CreatedAt, UpdatedAt)
SELECT DesignationID, LTRIM(RTRIM(DesignationName)), NULL, 0, ISNULL(IsActive, 1), CreatedDate, CAST(ModifiedDate AS datetime2) FROM [{{SOURCE}}].dbo.Designation;
SET IDENTITY_INSERT dbo.Designations OFF;

SET IDENTITY_INSERT dbo.States ON;
INSERT dbo.States (Id, Name, Description, SortOrder, IsActive, CreatedAt, UpdatedAt)
SELECT StateID, LTRIM(RTRIM(StateName)), NULL, 0, IsActive, CreatedDate, LastModifiedDate FROM [{{SOURCE}}].dbo.States;
SET IDENTITY_INSERT dbo.States OFF;

SET IDENTITY_INSERT dbo.Districts ON;
INSERT dbo.Districts (Id, Name, Description, SortOrder, IsActive, CreatedAt, UpdatedAt)
SELECT DistrictID, LTRIM(RTRIM(DistrictName)), NULL, 0, IsActive, CreatedDate, LastModifiedDate FROM [{{SOURCE}}].dbo.Districts;
SET IDENTITY_INSERT dbo.Districts OFF;

SET IDENTITY_INSERT dbo.Segments ON;
INSERT dbo.Segments (Id, Name, Description, SortOrder, IsActive, CreatedAt, UpdatedAt)
SELECT SegmentID, LTRIM(RTRIM(Segment)), Description, 0, IsActive, CreatedDate, LastModifiedDate FROM [{{SOURCE}}].dbo.Segments;
SET IDENTITY_INSERT dbo.Segments OFF;

SET IDENTITY_INSERT dbo.AccountTypes ON;
INSERT dbo.AccountTypes (Id, Name, Description, SortOrder, IsActive, CreatedAt, UpdatedAt)
SELECT AccountTypeID, LTRIM(RTRIM(AccountType)), Description, 0, IsActive, CreatedDate, LastModifiedDate FROM [{{SOURCE}}].dbo.AccountTypes;
SET IDENTITY_INSERT dbo.AccountTypes OFF;

SET IDENTITY_INSERT dbo.Applications ON;
INSERT dbo.Applications (Id, Name, Description, SortOrder, IsActive, CreatedAt, UpdatedAt)
SELECT ApplicationID, LTRIM(RTRIM(Application)), Description, 0, IsActive, CreatedDate, LastModifiedDate FROM [{{SOURCE}}].dbo.Applications;
SET IDENTITY_INSERT dbo.Applications OFF;

SET IDENTITY_INSERT dbo.VisitTypes ON;
INSERT dbo.VisitTypes (Id, Name, Description, SortOrder, IsActive, CreatedAt, UpdatedAt)
SELECT VisitTypeID, LTRIM(RTRIM(VisitType)), Description, 0, IsActive, CreatedDate, LastModifiedDate FROM [{{SOURCE}}].dbo.VisitTypes;
SET IDENTITY_INSERT dbo.VisitTypes OFF;

SET IDENTITY_INSERT dbo.LeadTypes ON;
INSERT dbo.LeadTypes (Id, Name, Description, SortOrder, IsActive, CreatedAt, UpdatedAt)
SELECT LeadTypeID, LTRIM(RTRIM(LeadType)), Description, 0, IsActive, CreatedDate, LastModifiedDate FROM [{{SOURCE}}].dbo.LeadTypes;
SET IDENTITY_INSERT dbo.LeadTypes OFF;

SET IDENTITY_INSERT dbo.ProductRanges ON;
INSERT dbo.ProductRanges (Id, Name, Description, SortOrder, IsActive, CreatedAt, UpdatedAt)
SELECT ProductRangeID, LTRIM(RTRIM(Product)), Description, 0, IsActive, CreatedDate, LastModifiedDate FROM [{{SOURCE}}].dbo.ProductRange;
SET IDENTITY_INSERT dbo.ProductRanges OFF;

SET IDENTITY_INSERT dbo.PumpTechnologies ON;
INSERT dbo.PumpTechnologies (Id, Name, Description, SortOrder, IsActive, CreatedAt, UpdatedAt)
SELECT PumpTID, LTRIM(RTRIM(PumpTechnologies)), Description, 0, IsActive, CreatedDate, LastModifiedDate FROM [{{SOURCE}}].dbo.PumpTechnologies;
SET IDENTITY_INSERT dbo.PumpTechnologies OFF;

SET IDENTITY_INSERT dbo.CompetitionMakes ON;
INSERT dbo.CompetitionMakes (Id, Name, Description, SortOrder, IsActive, CreatedAt, UpdatedAt)
SELECT CompetitionMakeID, LTRIM(RTRIM(CompetitionMake)), Description, 0, IsActive, CreatedDate, LastModifiedDate FROM [{{SOURCE}}].dbo.CompetitionMake;
SET IDENTITY_INSERT dbo.CompetitionMakes OFF;

SET IDENTITY_INSERT dbo.SalesPhases ON;
INSERT dbo.SalesPhases (Id, Name, Description, SortOrder, IsActive, CreatedAt, UpdatedAt)
SELECT SalesPhaseID, LTRIM(RTRIM(SalesPhase)), Description, 0, IsActive, CreatedDate, LastModifiedDate FROM [{{SOURCE}}].dbo.SalesPhase;
SET IDENTITY_INSERT dbo.SalesPhases OFF;

SET IDENTITY_INSERT dbo.OpportunityModes ON;
INSERT dbo.OpportunityModes (Id, Name, Description, SortOrder, IsActive, CreatedAt, UpdatedAt)
SELECT OpportunityModeID, LTRIM(RTRIM(OpportunityMode)), Description, 0, IsActive, CreatedDate, LastModifiedDate FROM [{{SOURCE}}].dbo.OpportunityMode;
SET IDENTITY_INSERT dbo.OpportunityModes OFF;

SET IDENTITY_INSERT dbo.WinningReasons ON;
INSERT dbo.WinningReasons (Id, Name, Description, SortOrder, IsActive, CreatedAt, UpdatedAt)
SELECT WinningReasonID, LTRIM(RTRIM(WinningReason)), Description, 0, IsActive, CreatedDate, LastModifiedDate FROM [{{SOURCE}}].dbo.WinningReasons;
SET IDENTITY_INSERT dbo.WinningReasons OFF;

SET IDENTITY_INSERT dbo.LosingReasons ON;
INSERT dbo.LosingReasons (Id, Name, Description, SortOrder, IsActive, CreatedAt, UpdatedAt)
SELECT LossingReasonID, LTRIM(RTRIM(LossingReason)), Description, 0, IsActive, CreatedDate, LastModifiedDate FROM [{{SOURCE}}].dbo.LossingReasons;
SET IDENTITY_INSERT dbo.LosingReasons OFF;

-- ---- Dealers ------------------------------------------------------------------------------

SET IDENTITY_INSERT dbo.Dealers ON;
INSERT dbo.Dealers (Id, Name, Description, ZoneId, Address, Mobile, Pan, Email, Gstn, IsActive, CreatedAt, UpdatedAt)
SELECT DealerID, LTRIM(RTRIM(Dealer)), NULLIF(LTRIM(RTRIM(Description)), ''), ZoneID, DealerAddress, MobileNumber,
       PANNumber, EmailID, GSTNNumber, IsActive, CreatedDate, LastModifiedDate
FROM [{{SOURCE}}].dbo.Dealers;
SET IDENTITY_INSERT dbo.Dealers OFF;

-- ---- Users: three old login tables become one ---------------------------------------------
-- Password hashes are copied as they are (PasswordScheme 0 = legacy SHA-256).
-- Many old rows repeat the full name in LastName ("Naresh Sutar" / "Naresh Sutar"); the repeat is dropped.
-- Each hash is upgraded to PBKDF2 the first time its owner signs in.

INSERT dbo.Users (LoginName, PasswordHash, PasswordScheme, FirstName, LastName, Email, Mobile, UserType, RoleId,
                  DealerId, DesignationId, MustChangePassword, FailedLoginCount, IsActive, CreatedAt, UpdatedAt, LegacySource, LegacyId)
SELECT LTRIM(RTRIM(u.LoginName)), u.UserPassword, 0, LTRIM(RTRIM(u.FirstName)), CASE WHEN LTRIM(RTRIM(u.FirstName)) LIKE '%' + LTRIM(RTRIM(u.LastName)) THEN '' ELSE LTRIM(RTRIM(u.LastName)) END, LTRIM(RTRIM(u.UserEmailID)),
       u.MobileNumber, 0, CASE u.RoleID WHEN 1 THEN @RoleAdmin ELSE @RoleSales END,
       NULL, d.Id, 0, 0, u.IsActive, u.CreatedDate, u.LastModifiedDate, 'Users', u.UserID
FROM [{{SOURCE}}].dbo.Users u
LEFT JOIN dbo.Designations d ON d.Id = u.DesignationID;

INSERT dbo.Users (LoginName, PasswordHash, PasswordScheme, FirstName, LastName, Email, Mobile, UserType, RoleId,
                  DealerId, DesignationId, MustChangePassword, FailedLoginCount, IsActive, CreatedAt, UpdatedAt, LegacySource, LegacyId)
SELECT LTRIM(RTRIM(a.UserName)), a.UserPassword, 0, LTRIM(RTRIM(a.FirstName)), CASE WHEN LTRIM(RTRIM(a.FirstName)) LIKE '%' + LTRIM(RTRIM(a.LastName)) THEN '' ELSE LTRIM(RTRIM(a.LastName)) END, LTRIM(RTRIM(a.EmailID)),
       NULL, 1, @RoleDealer, d.Id, NULL, 0, 0, a.IsActive, a.CreatedDate, a.LastModifiedDate, 'DealerAdmin', a.DealerAdminID
FROM [{{SOURCE}}].dbo.DealerAdmin a
LEFT JOIN dbo.Dealers d ON d.Id = a.DealerID;

INSERT dbo.Users (LoginName, PasswordHash, PasswordScheme, FirstName, LastName, Email, Mobile, UserType, RoleId,
                  DealerId, DesignationId, MustChangePassword, FailedLoginCount, IsActive, CreatedAt, UpdatedAt, LegacySource, LegacyId)
SELECT LTRIM(RTRIM(e.UserName)), e.UserPassword, 0, LTRIM(RTRIM(e.FirstName)), CASE WHEN LTRIM(RTRIM(e.FirstName)) LIKE '%' + LTRIM(RTRIM(e.LastName)) THEN '' ELSE LTRIM(RTRIM(e.LastName)) END, LTRIM(RTRIM(e.EmailID)),
       e.MobileNumber, 2, @RoleDealerUser, d.Id, NULL, 0, 0, e.IsActive, e.CreatedDate, e.LastModifiedDate, 'DealerEngineers', e.DealerSEID
FROM [{{SOURCE}}].dbo.DealerEngineers e
LEFT JOIN dbo.Dealers d ON d.Id = e.DealerID;

-- Zone mapping only existed for Edwards staff (old Users table).
INSERT dbo.UserZones (UserId, ZoneId)
SELECT DISTINCT u.Id, uz.ZoneID
FROM [{{SOURCE}}].dbo.UsersZone uz
JOIN dbo.Users u ON u.LegacySource = 'Users' AND u.LegacyId = uz.UserID
JOIN dbo.Zones z ON z.Id = uz.ZoneID
WHERE uz.IsActive = 1;

-- ---- Customers and contacts ---------------------------------------------------------------
-- Account name and company name were equal on every row, so only the company name is kept.
-- City is new and starts empty; users fill it in when they next edit the customer.

SET IDENTITY_INSERT dbo.Customers ON;
INSERT dbo.Customers (Id, CustomerDate, Name, Address, City, District, StateId, PinCode, Gst, SegmentId, AccountTypeId,
                      BusinessLineId, DealerId, DealerUserId, IsActive, CreatedAt, UpdatedAt)
SELECT a.AccountID, CAST(a.AccountDate AS date), LTRIM(RTRIM(a.CompanyName)), NULLIF(LTRIM(RTRIM(a.Address)), ''), NULL,
       NULLIF(LTRIM(RTRIM(a.DistrictName)), ''), s.Id, RIGHT('000000' + CAST(a.PinCode AS varchar(6)), 6),
       NULLIF(UPPER(LTRIM(RTRIM(a.GST))), ''), a.SegmentID, a.AccountTypeID, a.BusinessID, a.DealerID, u.Id,
       ISNULL(a.IsActive, 1), a.CreatedDate, a.LastModifiedDate
FROM [{{SOURCE}}].dbo.Accounts a
LEFT JOIN dbo.States s ON s.Name = LTRIM(RTRIM(a.StateName)) COLLATE DATABASE_DEFAULT
LEFT JOIN dbo.Users u ON u.LegacySource = 'DealerEngineers' AND u.LegacyId = a.DealerSEID;
SET IDENTITY_INSERT dbo.Customers OFF;

SET IDENTITY_INSERT dbo.Contacts ON;
INSERT dbo.Contacts (Id, CustomerId, PersonName, Designation, Email, Mobile, LandLine, ReportingTo, Department, IsActive, CreatedAt, UpdatedAt)
SELECT c.ContactID, c.AccountID, LTRIM(RTRIM(c.PersonName)), NULLIF(LTRIM(RTRIM(c.Designation)), ''), LTRIM(RTRIM(c.EmailID)),
       LTRIM(RTRIM(c.MobileNumber)), NULLIF(LTRIM(RTRIM(c.LandLineNumber)), ''), NULLIF(LTRIM(RTRIM(c.ReportingID)), ''),
       NULLIF(LTRIM(RTRIM(c.Department)), ''), c.IsActive, c.CreatedDate, c.LastModifiedDate
FROM [{{SOURCE}}].dbo.Contacts c;
SET IDENTITY_INSERT dbo.Contacts OFF;

COMMIT TRANSACTION;

SELECT 'Zones' AS TableName, COUNT(*) AS RowsImported FROM dbo.Zones
UNION ALL SELECT 'Business lines', COUNT(*) FROM dbo.BusinessLines
UNION ALL SELECT 'Other masters', (SELECT COUNT(*) FROM dbo.Designations) + (SELECT COUNT(*) FROM dbo.States)
    + (SELECT COUNT(*) FROM dbo.Districts) + (SELECT COUNT(*) FROM dbo.Segments) + (SELECT COUNT(*) FROM dbo.AccountTypes)
    + (SELECT COUNT(*) FROM dbo.Applications) + (SELECT COUNT(*) FROM dbo.VisitTypes) + (SELECT COUNT(*) FROM dbo.LeadTypes)
    + (SELECT COUNT(*) FROM dbo.ProductRanges) + (SELECT COUNT(*) FROM dbo.PumpTechnologies) + (SELECT COUNT(*) FROM dbo.CompetitionMakes)
    + (SELECT COUNT(*) FROM dbo.SalesPhases) + (SELECT COUNT(*) FROM dbo.OpportunityModes)
    + (SELECT COUNT(*) FROM dbo.WinningReasons) + (SELECT COUNT(*) FROM dbo.LosingReasons)
UNION ALL SELECT 'Dealers', COUNT(*) FROM dbo.Dealers
UNION ALL SELECT 'Users', COUNT(*) FROM dbo.Users WHERE LegacySource IS NOT NULL
UNION ALL SELECT 'User zones', COUNT(*) FROM dbo.UserZones
UNION ALL SELECT 'Customers', COUNT(*) FROM dbo.Customers
UNION ALL SELECT 'Contacts', COUNT(*) FROM dbo.Contacts;
