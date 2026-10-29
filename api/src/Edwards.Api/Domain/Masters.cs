using System.ComponentModel.DataAnnotations.Schema;

namespace Edwards.Api.Domain;

// Each master keeps its own table so other records can reference it with a real foreign key.

public class Zone : MasterEntity;
public class BusinessLine : MasterEntity;
public class Designation : MasterEntity;
public class State : MasterEntity;
public class District : MasterEntity;
public class Segment : MasterEntity;
public class AccountType : MasterEntity;

/// <summary>What the customer uses vacuum for (bottle filling, drying...). Called "Application" in today's app.</summary>
public class ApplicationArea : MasterEntity;

public class VisitType : MasterEntity;
public class LeadType : MasterEntity;
public class ProductRange : MasterEntity;
public class PumpTechnology : MasterEntity;
public class CompetitionMake : MasterEntity;
public class SalesPhase : MasterEntity;
public class OpportunityMode : MasterEntity;
public class WinningReason : MasterEntity;
public class LosingReason : MasterEntity;
public class AmcType : MasterEntity;
public class DocumentType : MasterEntity;

/// <summary>A master value that belongs to a value in another list (a product model belongs to a product range).</summary>
public interface IHasParent
{
    int ParentId { get; set; }
}

/// <summary>A master value that also carries a number (a winning chance carries its percentage).</summary>
public interface IHasNumber
{
    int Number { get; set; }
}

public class ProductModel : MasterEntity, IHasParent
{
    public int ProductRangeId { get; set; }
    public ProductRange? ProductRange { get; set; }

    [NotMapped]
    public int ParentId { get => ProductRangeId; set => ProductRangeId = value; }
}

public class WinningChance : MasterEntity, IHasNumber
{
    public int Percentage { get; set; }

    [NotMapped]
    public int Number { get => Percentage; set => Percentage = value; }
}
