import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { controlError, fieldErrors, problemMessage, ToastService } from '../core/support';

@Component({
  selector: 'app-change-password',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Change password</h1>
        @if (auth.me()?.mustChangePassword) {
          <p class="sub">Choose a new password before you continue.</p>
        }
      </div>
    </div>
    <form class="panel narrow" [formGroup]="form" (ngSubmit)="save()" novalidate>
      <div class="panel-heading"><h3>New password</h3></div>
      <div class="panel-body stack">
        @if (error()) { <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div> }
        <div class="field">
          <label for="currentPassword">Current password<span class="req">*</span></label>
          <input id="currentPassword" class="input" type="password" formControlName="currentPassword" autocomplete="current-password"
                 [class.invalid]="err('currentPassword')">
          @if (err('currentPassword'); as m) { <span class="field-error">{{ m }}</span> }
        </div>
        <div class="field">
          <label for="newPassword">New password<span class="req">*</span></label>
          <input id="newPassword" class="input" type="password" formControlName="newPassword" autocomplete="new-password"
                 [class.invalid]="err('newPassword')">
          @if (err('newPassword'); as m) { <span class="field-error">{{ m }}</span> }
          @else { <span class="hint">At least 8 characters, with at least one letter and one number.</span> }
        </div>
        <div class="field">
          <label for="confirm">Confirm new password<span class="req">*</span></label>
          <input id="confirm" class="input" type="password" formControlName="confirm" autocomplete="new-password"
                 [class.invalid]="err('confirm')">
          @if (err('confirm'); as m) { <span class="field-error">{{ m }}</span> }
        </div>
      </div>
      <div class="panel-footer">
        <button type="submit" class="btn btn-primary" [disabled]="busy()">Change password</button>
      </div>
    </form>
  `,
  styles: `.narrow { max-width: 460px; } .stack { display: flex; flex-direction: column; gap: 14px; }`,
})
export class ChangePassword {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly form = inject(FormBuilder).nonNullable.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirm: ['', Validators.required],
    },
    { validators: matching },
  );
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly server = signal<Record<string, string>>({});

  protected err(name: string): string | null {
    if (name === 'confirm' && (this.submitted() || this.form.controls.confirm.touched) && this.form.hasError('mismatch')) {
      return 'The two new passwords do not match.';
    }
    return controlError(this.form, name, this.submitted(), this.server());
  }

  protected save(): void {
    this.submitted.set(true);
    this.server.set({});
    this.error.set(null);
    if (this.form.invalid) return;

    this.busy.set(true);
    const { currentPassword, newPassword } = this.form.getRawValue();
    this.auth.changePassword(currentPassword, newPassword).subscribe({
      next: () => {
        this.toast.show('Password changed.');
        void this.router.navigateByUrl('/');
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const fields = fieldErrors(err);
        this.server.set(fields);
        if (Object.keys(fields).length === 0) this.error.set(problemMessage(err));
      },
    });
  }
}

function matching(group: AbstractControl): ValidationErrors | null {
  const next = group.get('newPassword')?.value as string;
  const confirm = group.get('confirm')?.value as string;
  return confirm && next !== confirm ? { mismatch: true } : null;
}
