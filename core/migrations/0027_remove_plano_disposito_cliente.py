# -*- coding: utf-8 -*-
from __future__ import unicode_literals

from django.db import models, migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0026_auto_20150416_1814'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='plano',
            name='disposito_cliente',
        ),
    ]
