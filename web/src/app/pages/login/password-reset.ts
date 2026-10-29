import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { fieldErrors, problemMessage } from '../../core/support';

/** Asks for a reset link. The answer is the same whether or not the login exists, so it cannot be used to find accounts. */
@Component({
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, RouterLink],
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="login-page">
      <div class="outer">
        <div class="box">
          <form class="form-side" [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <img class="logo" src="img/edwards-logo.png" alt="Edwards">
            @if (sent()) {
              <p class="notice">If the login or email belongs to an active account, a link to choose a new password is on its way. It works for 1 hour.</p>
              <div class="buttons"><a class="btn btn-primary" routerLink="/login">Back to sign in</a></div>
            } @else {
              <p class="hint">Enter your login name or email address. We will email you a link to choose a new password.</p>
              <div class="field">
                <label for="who">Login name or email</label>
                <div class="input-line" [class.invalid]="submitted() && form.invalid">
                  <input id="who" type="text" formControlName="loginOrEmail" autocomplete="username" autofocus>
                  <i class="fa-solid fa-user" aria-hidden="true"></i>
                </div>
                @if (submitted() && form.invalid) { <span class="field-error">Enter your login name or email.</span> }
              </div>
              @if (error()) { <p class="field-error login-error" role="alert">{{ error() }}</p> }
              <div class="buttons">
                <a class="link-btn" routerLink="/login">Back to sign in</a>
                <button type="submit" class="btn btn-primary" [disabled]="busy()">Send link</button>
              </div>
            }
          </form>
          <div class="picture-side" aria-hidden="true"></div>
        </div>
      </div>
    </div>
  `,
})
export class ForgotPassword {
  private readonly http = inject(HttpClient);
  protected readonly form = inject(FormBuilder).nonNullable.group({ loginOrEmail: ['', Validators.required] });
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    this.submitted.set(true);
    this.error.set(null);
    if (this.form.invalid) return;
    this.busy.set(true);
    this.http.post<void>('/api/auth/forgot-password', { loginOrEmail: this.form.getRawValue().loginOrEmail.trim() }).subscribe({
      next: () => {
        this.busy.set(false);
        this.sent.set(true);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(problemMessage(err));
      },
    });
  }
}

/** Opened from the emailed link (welcome or reset): the token in the address lets the user choose a password once. */
@Component({
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, RouterLink],
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="login-page">
      <div class="outer">
        <div class="box">
          <form class="form-side" [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <img class="logo" src="img/edwards-logo.png" alt="Edwards">
            @if (done()) {
              <p class="notice">Your password is set. Sign in with it now.</p>
              <div class="buttons"><a class="btn btn-primary" routerLink="/login">Sign in</a></div>
            } @else if (!token) {
              <p class="field-error login-error" role="alert">This link is incomplete. Open the link from the email again, or ask for a new one.</p>
              <div class="buttons"><a class="btn btn-primary" routerLink="/forgot-password">Ask for a new link</a></div>
            } @else {
              <p class="hint">Choose a password of at least 8 characters with a letter and a number.</p>
              <div class="field">
                <label for="pw">New password</label>
                <div class="input-line" [class.invalid]="submitted() && form.controls.password.invalid">
                  <input id="pw" type="password" formControlName="password" autocomplete="new-password" autofocus>
                  <i class="fa-solid fa-lock" aria-hidden="true"></i>
                </div>
                @if (submitted() && form.controls.password.invalid) { <span class="field-error">Use at least 8 characters.</span> }
              </div>
              <div class="field">
                <label for="pw2">Repeat the password</label>
                <div class="input-line" [class.invalid]="submitted() && mismatch()">
                  <input id="pw2" type="password" formControlName="repeat" autocomplete="new-password">
                  <i class="fa-solid fa-lock" aria-hidden="true"></i>
                </div>
                @if (submitted() && mismatch()) { <span class="field-error">The two passwords are not the same.</span> }
              </div>
              @if (error()) { <p class="field-error login-error" role="alert">{{ error() }}</p> }
              <div class="buttons">
                <a class="link-btn" routerLink="/forgot-password">Ask for a new link</a>
                <button type="submit" class="btn btn-primary" [disabled]="busy()">Set password</button>
              </div>
            }
          </form>
          <div class="picture-side" aria-hidden="true"></div>
        </div>
      </div>
    </div>
  `,
})
export class ResetPassword {
  private readonly http = inject(HttpClient);
  protected readonly token = inject(ActivatedRoute).snapshot.queryParamMap.get('token') ?? '';
  protected readonly form = inject(FormBuilder).nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(8)]],
    repeat: ['', Validators.required],
  });
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal<string | null>(null);

  protected mismatch(): boolean {
    const v = this.form.getRawValue();
    return v.password !== v.repeat;
  }

  protected submit(): void {
    this.submitted.set(true);
    this.error.set(null);
    if (this.form.invalid || this.mismatch()) return;
    this.busy.set(true);
    this.http.post<void>('/api/auth/reset-password', { token: this.token, newPassword: this.form.getRawValue().password }).subscribe({
      next: () => {
        this.busy.set(false);
        this.done.set(true);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(Object.values(fieldErrors(err))[0] ?? problemMessage(err, 'The password could not be set.'));
      },
    });
  }
}
