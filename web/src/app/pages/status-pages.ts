import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-forbidden',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel status">
      <div class="panel-body">
        <i class="fa-solid fa-lock"></i>
        <h1>Your role does not include this page</h1>
        <p class="muted">Ask an Edwards administrator to add the permission to your role if you need it.</p>
        <a class="btn btn-primary" routerLink="/">Go to the start page</a>
      </div>
    </div>
  `,
  styles: `.status .panel-body { padding: 40px 20px; text-align: center; } .status i { font-size: 34px; color: var(--edw-red); } .status h1 { font-size: 20px; font-weight: 600; color: var(--edw-slate); }`,
})
export class Forbidden {}

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel status">
      <div class="panel-body">
        <i class="fa-solid fa-compass"></i>
        <h1>This page does not exist</h1>
        <p class="muted">Check the address, or use the menu on the left.</p>
        <a class="btn btn-primary" routerLink="/">Go to the start page</a>
      </div>
    </div>
  `,
  styles: `.status .panel-body { padding: 40px 20px; text-align: center; } .status i { font-size: 34px; color: var(--edw-red); } .status h1 { font-size: 20px; font-weight: 600; color: var(--edw-slate); }`,
})
export class NotFound {}
