using System.Security.Cryptography;
using System.Text;
using Edwards.Api.Domain;
using Microsoft.AspNetCore.Identity;

namespace Edwards.Api.Auth;

public enum PasswordCheck
{
    Failed,
    Success,
    SuccessRehashNeeded,
}

/// <summary>
/// Hashes passwords with PBKDF2 (ASP.NET Core Identity format) and still accepts the unsalted SHA-256
/// hashes copied from today's app, so nobody has to reset their password after the move.
/// </summary>
public sealed class PasswordService
{
    public const int MinLength = 8;

    private readonly PasswordHasher<User> _hasher = new();
    private readonly string _dummyHash;

    public PasswordService()
    {
        _dummyHash = _hasher.HashPassword(new User(), Guid.NewGuid().ToString());
    }

    public string Hash(User user, string password) => _hasher.HashPassword(user, password);

    public PasswordCheck Verify(User user, string password)
    {
        if (user.PasswordScheme == PasswordScheme.LegacySha256)
        {
            // Today's app trimmed the password, then stored Base64(SHA-256(UTF-8)).
            var legacy = Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(password.Trim())));
            var matches = CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(legacy), Encoding.UTF8.GetBytes(user.PasswordHash.Trim()));
            return matches ? PasswordCheck.SuccessRehashNeeded : PasswordCheck.Failed;
        }

        return _hasher.VerifyHashedPassword(user, user.PasswordHash, password) switch
        {
            PasswordVerificationResult.Success => PasswordCheck.Success,
            PasswordVerificationResult.SuccessRehashNeeded => PasswordCheck.SuccessRehashNeeded,
            _ => PasswordCheck.Failed,
        };
    }

    /// <summary>Spends the same time as a real check, so a missing login name cannot be detected by timing.</summary>
    public void VerifyDummy(string password) =>
        _hasher.VerifyHashedPassword(new User(), _dummyHash, password);

    /// <summary>Returns a message for the user when the password breaks the policy, otherwise null.</summary>
    public static string? Validate(string password, string loginName)
    {
        if (password.Length < MinLength) return $"Use at least {MinLength} characters.";
        if (password != password.Trim()) return "The password cannot start or end with a space.";
        if (!password.Any(char.IsLetter) || !password.Any(char.IsDigit)) return "Use at least one letter and one number.";
        if (string.Equals(password, loginName, StringComparison.OrdinalIgnoreCase)) return "The password cannot be the same as the login name.";
        return null;
    }
}
